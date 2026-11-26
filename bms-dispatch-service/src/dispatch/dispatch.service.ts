import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { BookingClient, BookingRecord } from '../booking-client.service';
import { FleetService } from '../fleet/fleet.service';
import { checkBookingTiming, worstTiming, type TimedBooking, type TimingResult } from './assignment-timing';

const TRAVEL_CACHE_MS = 6 * 60 * 60 * 1000;

function requireUuid(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestException('Expected a booking or job order UUID');
  }
}

/** Today's date in Manila as YYYY-MM-DD, the same calendar the bookings use. */
function manilaToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/**
 * Reads an assignment request. A Subcon booking is done by a subcontractor's own truck and driver,
 * so it has no garage, vehicle or driver of ours: those are stored as null and only helpers are assigned.
 */
function assignmentFields(input: Record<string, unknown>) {
  const deliveryType = String(input.deliveryType ?? '');
  const subcon = deliveryType === 'Subcon';
  return {
    dispatchTime: String(input.dispatchTime ?? input.time ?? ''),
    deliveryType,
    subcon,
    garage: subcon ? null : String(input.garage ?? ''),
    vehicleId: subcon ? null : String(input.vehicleId ?? ''),
    driverId: subcon ? null : String(input.driverId ?? ''),
    helperIds: input.helperIds,
  };
}

/** Matches another assignment that holds the same truck, driver or any of the helpers. */
function sharesCrew(vehicleId: string | null, driverId: string | null, helperIds: string[]) {
  return [
    ...(vehicleId ? [{ vehicleId }] : []),
    ...(driverId ? [{ driverId }] : []),
    { helperIds: { hasSome: helperIds } },
  ];
}

/** Subcon assignments have no driver of ours; everything else needs one before a job order. */
function hasRequiredCrew(assignment: { deliveryType: string | null; driverId: string | null; helperIds: string[] }) {
  return assignment.helperIds.length > 0 && (assignment.deliveryType === 'Subcon' || Boolean(assignment.driverId));
}

@Injectable()
export class DispatchService {
  // Each lookup is a paid Google request, and the same addresses repeat while a dialog is open.
  private readonly travelCache = new Map<string, { minutes: number; expiresAt: number }>();

  constructor(private readonly prisma: PrismaService, private readonly bookings: BookingClient, private readonly fleet: FleetService) {}

  private async travelMinutes(from: string, to: string) {
    const key = `${from}|${to}`;
    const cached = this.travelCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.minutes;
    try {
      const { durationMin } = await this.bookings.route(from, to);
      this.travelCache.set(key, { minutes: durationMin, expiresAt: Date.now() + TRAVEL_CACHE_MS });
      return durationMin;
    } catch {
      return null;
    }
  }

  /** How each truck, driver and helper already working on this booking's date fits with it. Anyone not listed is free. */
  async resourceTiming(id: string) {
    requireUuid(id);
    const booking = await this.bookings.get(id);
    const others = await this.prisma.dispatchAssignment.findMany({ where: {
      bookingUuid: { not: id }, serviceDate: booking.date, state: { in: ['PENDING', 'CONFIRMED', 'RELEASING'] },
    } });
    const toTimed = (record: BookingRecord): TimedBooking => ({
      bookingNo: record.bookingNo || record.bookingId, pickupTime: record.preferredTime,
      pickupAddress: record.pickupAddress, deliveryAddress: record.deliveryAddress,
    });
    const groups = { vehicles: new Map<string, TimingResult[]>(), drivers: new Map<string, TimingResult[]>(), helpers: new Map<string, TimingResult[]>() };
    const add = (group: Map<string, TimingResult[]>, key: string | null, result: TimingResult) => {
      if (key) group.set(key, [...(group.get(key) ?? []), result]);
    };
    await Promise.all(others.map(async (other) => {
      const result = await checkBookingTiming(toTimed(booking), toTimed(await this.bookings.get(other.bookingUuid)),
        (from, to) => this.travelMinutes(from, to));
      add(groups.vehicles, other.vehicleId, result);
      add(groups.drivers, other.driverId, result);
      other.helperIds.forEach((helperId) => add(groups.helpers, helperId, result));
    }));
    const summarize = (group: Map<string, TimingResult[]>) => Object.fromEntries([...group].map(([key, results]) => [key, worstTiming(results)]));
    return { vehicles: summarize(groups.vehicles), drivers: summarize(groups.drivers), helpers: summarize(groups.helpers) };
  }

  private async enforceTiming(id: string, input: { vehicleId: string | null; driverId: string | null; helperIds: string[] }, travelConfirmed: boolean) {
    const timing = await this.resourceTiming(id);
    const results = [
      input.vehicleId ? timing.vehicles[input.vehicleId] : undefined, input.driverId ? timing.drivers[input.driverId] : undefined,
      ...input.helperIds.map((helperId) => timing.helpers[helperId]),
    ].filter((result): result is TimingResult => Boolean(result));
    const worst = worstTiming(results);
    if (worst.status === 'blocked') throw new ConflictException(worst.message);
    if (worst.status === 'unverified' && !travelConfirmed) {
      throw new ConflictException(`${worst.message} Confirm the timing yourself to continue.`);
    }
  }

  private formatSchedule(booking: BookingRecord, assignment?: { dispatchTime: string | null; garage: string | null; deliveryType: string | null; vehicleId: string | null; driverId: string | null; helperIds: string[]; state: string } | null,
    fleet?: { vehicles: Awaited<ReturnType<FleetService['vehicles']>>; drivers: Awaited<ReturnType<FleetService['drivers']>>; helpers: Awaited<ReturnType<FleetService['helpers']>> }) {
    const assigned = assignment?.state === 'CONFIRMED';
    return {
      ...booking, amount: booking.amount === null ? null : Number(booking.amount),
      bookingStatus: assigned ? 'Assigned' : booking.status,
      status: assigned ? 'Assigned' : 'Unassigned',
      pickupTime: booking.preferredTime ?? '', dispatchTime: assignment?.dispatchTime ?? '',
      origin: booking.pickupAddress ?? 'Unknown pickup', destination: booking.deliveryAddress ?? 'Unknown delivery',
      garage: assignment?.garage ?? null, deliveryType: assignment?.deliveryType ?? null,
      vehicleId: assignment?.vehicleId ?? null, driverId: assignment?.driverId ?? null,
      helperIds: assignment?.helperIds ?? [],
      vehicle: fleet?.vehicles.find((item) => item.id === assignment?.vehicleId) ?? null,
      assignedDriver: fleet?.drivers.find((item) => item.id === assignment?.driverId) ?? null,
      assignedHelpers: fleet?.helpers.filter((item) => assignment?.helperIds.includes(item.id)) ?? [],
    };
  }

  async schedules() {
    const [bookings, assignments, vehicles, drivers, helpers] = await Promise.all([
      this.bookings.list(), this.prisma.dispatchAssignment.findMany({ where: { state: 'CONFIRMED' } }),
      this.fleet.vehicles(), this.fleet.drivers(), this.fleet.helpers(),
    ]);
    const byBooking = new Map(assignments.map((item) => [item.bookingUuid, item]));
    return bookings.filter((item) => ['For Plotting', 'Rescheduled', 'Assigned'].includes(item.status))
      .map((item) => this.formatSchedule(item, byBooking.get(item.id), { vehicles, drivers, helpers }));
  }

  async schedule(id: string) {
    requireUuid(id);
    const [booking, assignment, vehicles, drivers, helpers] = await Promise.all([
      this.bookings.get(id), this.prisma.dispatchAssignment.findUnique({ where: { bookingUuid: id } }),
      this.fleet.vehicles(), this.fleet.drivers(), this.fleet.helpers(),
    ]);
    return this.formatSchedule(booking, assignment, { vehicles, drivers, helpers });
  }

  async tracking(bookingUuid: string) {
    requireUuid(bookingUuid);
    const [assignment, jobOrder, drivers, vehicles, helpers] = await Promise.all([
      this.prisma.dispatchAssignment.findUnique({ where: { bookingUuid } }),
      this.prisma.dispatchJobOrder.findUnique({ where: { bookingUuid } }),
      this.fleet.drivers(),
      this.fleet.vehicles(),
      this.fleet.helpers(),
    ]);
    const activeAssignment = assignment?.state === 'CONFIRMED' ? assignment : null;
    const driver = activeAssignment ? drivers.find((item) => item.id === activeAssignment.driverId) : null;
    const vehicle = activeAssignment ? vehicles.find((item) => item.id === activeAssignment.vehicleId) : null;
    const assignedHelpers = activeAssignment
      ? helpers.filter((item) => activeAssignment.helperIds.includes(item.id))
      : [];
    return {
      assignment: activeAssignment ? {
        updatedAt: activeAssignment.updatedAt.toISOString(),
        driverAssigned: Boolean(activeAssignment.driverId),
        driverName: driver?.fullName ?? (activeAssignment.deliveryType === 'Subcon' ? 'Subcontractor' : 'Assigned driver'),
        driverContact: driver?.contact ?? '',
        helperNames: assignedHelpers.map((helper) => helper.fullName),
        vehicleLabel: vehicle ? `${vehicle.plateNumber} ${vehicle.alias ?? ''}`.trim() : activeAssignment.deliveryType === 'Subcon' ? 'Subcontractor truck' : 'Unavailable vehicle',
      } : null,
      jobOrder: jobOrder ? { status: jobOrder.status, updatedAt: jobOrder.updatedAt.toISOString() } : null,
    };
  }

  async postServiceReadyBookingUuids() {
    const distributedOrders = await this.prisma.dispatchJobOrder.findMany({
      where: { status: 'Distributed', state: 'ACTIVE', truck: { not: null }, team: { not: null } },
      select: { bookingUuid: true },
    });
    if (!distributedOrders.length) return [];
    const assignments = await this.prisma.dispatchAssignment.findMany({
      where: {
        bookingUuid: { in: distributedOrders.map((item) => item.bookingUuid) },
        state: 'CONFIRMED', helperIds: { isEmpty: false }, dispatchTime: { not: null },
        OR: [
          { deliveryType: 'Subcon' },
          { deliveryType: { not: null }, driverId: { not: null }, vehicleId: { not: null }, garage: { not: null } },
        ],
      },
      select: { bookingUuid: true },
    });
    return assignments.map((item) => item.bookingUuid);
  }

  private async releaseAssignment(id: string) {
    let current = await this.prisma.dispatchAssignment.findUniqueOrThrow({ where: { id } });
    const order = await this.prisma.dispatchJobOrder.findUnique({ where: { bookingUuid: id } });
    if (order?.status === 'Distributed') throw new ConflictException('Distributed work requires operator review before reassignment');
    if (current.state === 'CONFIRMED') {
      const booking = await this.bookings.get(id);
      if (booking.status !== 'Assigned' || booking.paymentHold) throw new ConflictException('Booking work or payment prevents reassignment');
      const changed = await this.prisma.dispatchAssignment.updateMany({
        where: { id, state: 'CONFIRMED' },
        data: { state: 'RELEASING', releaseCommandId: randomUUID(), releaseBookingVersion: booking.version, lastError: null },
      });
      if (changed.count !== 1) throw new ConflictException('Assignment changed; retry');
      current = await this.prisma.dispatchAssignment.findUniqueOrThrow({ where: { id } });
    }
    if (current.state !== 'RELEASING') throw new ConflictException('Assignment is not ready to release');
    try {
      try {
        await this.bookings.command(id, {
          commandId: current.releaseCommandId, kind: 'ReleaseAssignment',
          expectedVersion: current.releaseBookingVersion, reference: current.id,
        });
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
        const booking = await this.bookings.get(id);
        if (booking.status !== 'Assigned' || booking.paymentHold) throw error;
        current = await this.prisma.dispatchAssignment.update({ where: { id }, data: {
          releaseCommandId: randomUUID(), releaseBookingVersion: booking.version,
        } });
        await this.bookings.command(id, {
          commandId: current.releaseCommandId, kind: 'ReleaseAssignment',
          expectedVersion: current.releaseBookingVersion, reference: current.id,
        });
      }
    } catch (error) {
      await this.prisma.dispatchAssignment.update({ where: { id }, data: {
        lastError: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown release error',
      } });
      throw error;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.dispatchAssignment.update({ where: { id }, data: { state: 'REJECTED', lastError: null } });
      if (order) await tx.dispatchJobOrder.update({ where: { id: order.id }, data: { state: 'SUPERSEDED', status: 'Pending' } });
    });
  }

  async assign(id: string, input: Record<string, unknown>, actor: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actor)) throw new BadRequestException('Unable to identify the assigning user');
    await this.enforcePermitCrewLock(id, input);
    // The usual slot and travel-time (double-booking) checks still run for every assignment, permit or not.
    const validated = await this.validateAssignment(id, input);
    await this.enforceTiming(id, validated, input.travelConfirmed === true);
    return this.confirmAssignment(id, validated, actor);
  }

  /**
   * A booking that needs a barangay pass / permit is filed under a specific truck and crew, so once it is
   * assigned Operations can no longer swap them. Dispatch time, garage and delivery type may still change.
   * A reschedule or cancellation (approved by Admin) clears the assignment and lifts the lock.
   */
  private async enforcePermitCrewLock(id: string, input: Record<string, unknown>) {
    requireUuid(id);
    const [booking, assignment] = await Promise.all([
      this.bookings.get(id),
      this.prisma.dispatchAssignment.findUnique({ where: { bookingUuid: id } }),
    ]);
    if (!booking.permitRequired || !assignment || !['PENDING', 'CONFIRMED', 'RELEASING'].includes(assignment.state)) return;
    const requested = assignmentFields(input);
    const requestedHelpers = Array.isArray(input.helperIds) ? (input.helperIds as unknown[]).map(String) : [];
    const sameHelpers = requestedHelpers.length === assignment.helperIds.length &&
      [...requestedHelpers].sort().join('|') === [...assignment.helperIds].sort().join('|');
    if (requested.vehicleId !== assignment.vehicleId || requested.driverId !== assignment.driverId || !sameHelpers) {
      throw new ConflictException('This booking requires a permit, so its truck, driver and helpers are locked once assigned. You can still change the dispatch time, garage and delivery type.');
    }
  }

  async validateAssignment(id: string, input: Record<string, unknown>) {
    requireUuid(id);
    const { dispatchTime, garage, deliveryType, vehicleId, driverId, helperIds, subcon } = assignmentFields(input);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dispatchTime) || (!subcon && !garage) || !['Inhouse', 'Subcon'].includes(deliveryType) ||
      !Array.isArray(helperIds) || helperIds.length === 0 || helperIds.some((value) => typeof value !== 'string')) {
      throw new BadRequestException(subcon
        ? 'Complete dispatch time, delivery type, and helpers'
        : 'Complete dispatch time, garage, delivery type, vehicle, driver, and helpers');
    }
    const booking = await this.bookings.get(id);
    // A truck can't be sent on a day that has already gone; CS reschedules first.
    if (String(booking.date ?? '').slice(0, 10) < manilaToday()) {
      throw new ConflictException('The service date has passed. Customer Service needs to reschedule this booking before it can be assigned.');
    }
    const assignment = await this.prisma.dispatchAssignment.findUnique({ where: { bookingUuid: id } });
    if (!assignment && !['For Plotting', 'Rescheduled'].includes(booking.status)) {
      throw new ConflictException('Booking is not ready for assignment');
    }
    if (!subcon) {
      const activeGarage = (await this.fleet.garages()).some((item) => item.name === garage);
      if (!activeGarage) throw new BadRequestException('Garage is unavailable');
    }
    await this.fleet.checkAssignment(vehicleId, driverId, helperIds as string[], String(booking.date ?? ''));
    if ((await this.bookings.pendingChange(id)).pending) throw new ConflictException('This booking has a pending reschedule or cancellation request');
    const conflict = await this.prisma.dispatchAssignment.findFirst({ where: {
      bookingUuid: { not: id }, serviceDate: booking.date, dispatchTime,
      state: { in: ['PENDING', 'CONFIRMED', 'RELEASING'] },
      OR: sharesCrew(vehicleId, driverId, helperIds as string[]),
    } });
    if (conflict) throw new ConflictException('Vehicle or crew is already assigned in this slot');
    const [vehicles, drivers, helpers] = await Promise.all([this.fleet.vehicles(), this.fleet.drivers(), this.fleet.helpers()]);
    return {
      dispatchTime, garage, deliveryType, vehicleId, driverId, helperIds: helperIds as string[],
      vehicleLabel: subcon ? 'Subcon' : vehicles.find((item) => item.id === vehicleId)?.plateNumber ?? 'Unavailable vehicle',
      driverName: subcon ? 'Subcon' : drivers.find((item) => item.id === driverId)?.fullName ?? driverId,
      helperNames: (helperIds as string[]).map((helperId) => helpers.find((item) => item.id === helperId)?.fullName ?? helperId),
    };
  }

  private async confirmAssignment(id: string, input: Record<string, unknown>, actor?: string) {
    requireUuid(id);
    const { dispatchTime, garage, deliveryType, vehicleId, driverId, helperIds } = assignmentFields(input);
    let booking = await this.bookings.get(id);
    const vehicle = await this.fleet.checkAssignment(vehicleId, driverId, helperIds as string[], String(booking.date ?? ''));
    const assignedDriverName = driverId
      ? String((await this.fleet.drivers()).find((item) => item.id === driverId)?.fullName ?? driverId)
      : null;
    // Sent with ConfirmAssignment so the customer's "Team assigned" email can name the truck and crew.
    // (Booking emails while this assignment is still PENDING here, so it can't look the team up itself.)
    // A Subcon assignment has no truck or driver of ours, so the email lists only the helpers.
    const [fleetVehicles, fleetHelpers] = await Promise.all([this.fleet.vehicles(), this.fleet.helpers()]);
    const truck = vehicleId ? fleetVehicles.find((item) => item.id === vehicleId) : undefined;
    const helperNames = (helperIds as string[]).map((helperId) => fleetHelpers.find((item) => item.id === helperId)?.fullName).filter((name): name is string => Boolean(name));
    const team = {
      truck: truck ? `${truck.plateNumber} ${truck.alias ?? ''}`.trim() : vehicle.plateNumber ?? undefined,
      driverName: assignedDriverName ?? undefined,
      helperNames,
      dispatchTime,
    };
    // The job order's truck and team columns: Subcon has no plate or driver, so it shows "Subcon" and the helpers.
    const jobOrderTruck = vehicle.plateNumber ?? 'Subcon';
    const jobOrderTeam = (assignedDriverName ?? (helperNames.join(', ') || 'Subcon')).slice(0, 100);
    let assignment = await this.prisma.dispatchAssignment.findUnique({ where: { bookingUuid: id } });
    if (!assignment && (!['For Plotting', 'Rescheduled'].includes(booking.status) || booking.operationalHold || booking.paymentHold)) {
      throw new ConflictException('Booking is no longer ready for assignment');
    }
    if (assignment?.state === 'CONFIRMED') {
      if (assignment.dispatchTime === dispatchTime && assignment.vehicleId === vehicleId && assignment.driverId === driverId &&
        assignment.garage === garage && assignment.deliveryType === deliveryType &&
        JSON.stringify(assignment.helperIds) === JSON.stringify(helperIds)) return this.schedule(id);
      if (booking.status !== 'Assigned' || booking.paymentHold) throw new ConflictException('Booking work or payment prevents reassignment');
      const conflicting = await this.prisma.dispatchAssignment.findFirst({ where: {
        id: { not: id }, serviceDate: booking.date, dispatchTime,
        state: { in: ['PENDING', 'CONFIRMED', 'RELEASING'] },
        OR: sharesCrew(vehicleId, driverId, helperIds as string[]),
      } });
      if (conflicting) throw new ConflictException('Vehicle or crew is held in this slot');
      await this.releaseAssignment(id);
      booking = await this.bookings.get(id);
      assignment = await this.prisma.dispatchAssignment.findUnique({ where: { bookingUuid: id } });
    }
    if (assignment?.state === 'RELEASING') {
      await this.releaseAssignment(id);
      booking = await this.bookings.get(id);
      assignment = await this.prisma.dispatchAssignment.findUnique({ where: { bookingUuid: id } });
    }
    if (assignment?.state === 'REJECTED') {
      if (!['For Plotting', 'Rescheduled'].includes(booking.status) || booking.operationalHold) {
        throw new ConflictException('Booking is no longer ready for assignment');
      }
      assignment = await this.prisma.dispatchAssignment.update({ where: { id }, data: {
        serviceDate: booking.date, dispatchTime, garage, deliveryType, vehicleId, driverId,
        helperIds: helperIds as string[], state: 'PENDING', confirmCommandId: randomUUID(),
        bookingVersion: booking.version, lastError: null,
      } });
    }
    if (!assignment) {
      try {
        assignment = await this.prisma.dispatchAssignment.create({ data: {
          id, bookingUuid: id, serviceDate: booking.date, dispatchTime, garage, deliveryType,
          vehicleId, driverId, helperIds: helperIds as string[], state: 'PENDING',
          confirmCommandId: randomUUID(), bookingVersion: booking.version,
          createdAt: new Date(), updatedAt: new Date(),
        } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('Vehicle, driver, or booking already has an assignment in this slot');
        }
        throw error;
      }
    }
    if (assignment.serviceDate !== booking.date || assignment.dispatchTime !== dispatchTime || assignment.vehicleId !== vehicleId ||
      assignment.driverId !== driverId || assignment.garage !== garage) {
      throw new ConflictException('Pending assignment differs from this request');
    }
    try {
      try {
        await this.bookings.command(id, {
          commandId: assignment.confirmCommandId, kind: 'ConfirmAssignment',
          expectedVersion: assignment.bookingVersion, reference: assignment.id, actor, team,
        });
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
        const current = await this.bookings.get(id);
        if (!['For Plotting', 'Rescheduled'].includes(current.status) || current.operationalHold || current.paymentHold) throw error;
        assignment = await this.prisma.dispatchAssignment.update({ where: { id }, data: {
          confirmCommandId: randomUUID(), bookingVersion: current.version, lastError: null,
        } });
        await this.bookings.command(id, {
          commandId: assignment.confirmCommandId, kind: 'ConfirmAssignment',
          expectedVersion: assignment.bookingVersion, reference: assignment.id, actor, team,
        });
      }
    } catch (error) {
      await this.prisma.dispatchAssignment.update({ where: { id }, data: {
        state: error instanceof ConflictException ? 'REJECTED' : 'PENDING',
        lastError: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown error',
      } });
      throw error;
    }
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.dispatchAssignment.findUniqueOrThrow({ where: { id } });
      if (current.state !== 'CONFIRMED') {
        await tx.dispatchAssignment.update({ where: { id }, data: { state: 'CONFIRMED', lastError: null } });
        const [{ value }] = await tx.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('dispatch_job_order_no_seq') AS value`;
        await tx.dispatchJobOrder.upsert({ where: { bookingUuid: id },
          create: {
            id, bookingUuid: id, bookingIdAlias: booking.bookingId,
            jobOrderNo: `JO-${new Date().getFullYear()}-${String(value).padStart(4, '0')}`,
            client: booking.client, serviceDate: booking.date, truck: jobOrderTruck,
            team: jobOrderTeam,
            status: 'Pending', state: 'ACTIVE',
            generatedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
          },
          update: { client: booking.client, serviceDate: booking.date, truck: jobOrderTruck,
            team: jobOrderTeam, status: 'Pending', state: 'ACTIVE', updatedAt: new Date() },
        });
      }
    });
    return this.schedule(id);
  }

  assignments() { return this.prisma.dispatchAssignment.findMany({ orderBy: { createdAt: 'desc' } }); }

  async releaseForReview(bookingUuid: string) {
    requireUuid(bookingUuid);
    await this.releaseAssignment(bookingUuid);
    return this.assignment(bookingUuid);
  }

  async retryAssignment(bookingUuid: string) {
    requireUuid(bookingUuid);
    const item = await this.assignment(bookingUuid);
    if (item.state === 'RELEASING') {
      await this.releaseAssignment(bookingUuid);
      return this.assignment(bookingUuid);
    }
    if (item.state !== 'PENDING') throw new ConflictException('Only pending assignment commands can be retried');
    return this.confirmAssignment(bookingUuid, {
      dispatchTime: item.dispatchTime, garage: item.garage, deliveryType: item.deliveryType,
      vehicleId: item.vehicleId, driverId: item.driverId, helperIds: item.helperIds,
    });
  }

  async assignment(bookingUuid: string) {
    requireUuid(bookingUuid);
    const item = await this.prisma.dispatchAssignment.findUnique({ where: { bookingUuid } });
    if (!item) throw new NotFoundException('Assignment not found');
    return item;
  }

  jobOrders() { return this.prisma.dispatchJobOrder.findMany({ orderBy: { createdAt: 'desc' } }); }

  private async formatJobOrder(item: Awaited<ReturnType<DispatchService['jobOrder']>>) {
    const booking = await this.bookings.get(item.bookingUuid);
    return {
      ...item, bookingId: item.bookingIdAlias, bookingNo: booking.bookingNo,
      totalAmount: `₱${Number(booking.amount ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      paymentStatus: 'Unknown',
    };
  }

  async legacyJobOrders() {
    const items = await this.jobOrders();
    if (!items.length) return [];
    const completeAssignments = await this.prisma.dispatchAssignment.findMany({
      where: {
        bookingUuid: { in: items.map((item) => item.bookingUuid) },
        state: 'CONFIRMED',
        helperIds: { isEmpty: false },
        OR: [{ deliveryType: 'Subcon' }, { driverId: { not: null } }],
      },
      select: { bookingUuid: true },
    });
    const assignedBookingUuids = new Set(completeAssignments.map((item) => item.bookingUuid));
    return Promise.all(items
      .filter((item) => assignedBookingUuids.has(item.bookingUuid))
      .map((item) => this.formatJobOrder(item)));
  }

  async assignedBookings() {
    return (await this.schedules()).filter((item) =>
      item.status === 'Assigned' && item.helperIds.length > 0 && item.assignedHelpers.length > 0 &&
      (item.deliveryType === 'Subcon' || (Boolean(item.driverId) && Boolean(item.assignedDriver))),
    );
  }

  async legacyJobOrder(id: string) { return this.formatJobOrder(await this.jobOrder(id)); }

  async generateJobOrder(bookingIdAlias: string) {
    const booking = (await this.bookings.list()).find((item) => item.bookingId === bookingIdAlias || item.id === bookingIdAlias);
    if (!booking || booking.status !== 'Assigned') throw new ConflictException('Only assigned bookings can have a job order');
    const assignment = await this.prisma.dispatchAssignment.findUnique({ where: { bookingUuid: booking.id } });
    if (assignment?.state !== 'CONFIRMED' || !hasRequiredCrew(assignment)) {
      throw new ConflictException('A driver and at least one helper must be assigned before a job order is available');
    }
    const item = await this.prisma.dispatchJobOrder.findUnique({ where: { bookingUuid: booking.id } });
    if (!item) throw new ConflictException('Assignment confirmation is still pending');
    return this.formatJobOrder(item);
  }

  async updateJobOrder(id: string, body: { status?: string }) {
    requireUuid(id);
    if (body.status !== 'Distributed') throw new BadRequestException('Only distribution is supported; payment is owned by Completion');
    const item = await this.jobOrder(id);
    const booking = await this.bookings.get(item.bookingUuid);
    if (booking.status !== 'Assigned') throw new ConflictException('Only an assigned booking can be distributed');
    const assignment = await this.prisma.dispatchAssignment.findUnique({ where: { bookingUuid: item.bookingUuid } });
    if (assignment?.state !== 'CONFIRMED' || !hasRequiredCrew(assignment)) {
      throw new ConflictException('A driver and at least one helper must be assigned before a job order can be distributed');
    }
    const alreadyDistributed = item.status === 'Distributed';
    const updated = await this.prisma.dispatchJobOrder.update({ where: { id }, data: { status: 'Distributed', updatedAt: new Date() } });
    if (!alreadyDistributed) {
      const key = process.env.BMS_INTERNAL_SERVICE_KEY;
      const root = process.env.BOOKING_API_URL || 'http://127.0.0.1:3021';
      if (key && key.length >= 32) {
        try {
          await fetch(new URL(`/internal/booking/${item.bookingUuid}/tracking-update`, root), {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-bms-service-key': key },
            body: JSON.stringify({ update: 'In Transit' }), signal: AbortSignal.timeout(5000),
          });
        } catch { /* The tracking page still reads the current dispatch status when the customer opens it. */ }
      }
    }
    return this.formatJobOrder(updated);
  }

  async jobOrder(id: string) {
    requireUuid(id);
    const item = await this.prisma.dispatchJobOrder.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Job order not found');
    return item;
  }
}
