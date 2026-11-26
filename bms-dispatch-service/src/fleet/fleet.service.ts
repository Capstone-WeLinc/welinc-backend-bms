import { DirectoryClient } from '../auth/directory.client';
import { accountFields, linkedCrew } from './crew-roster';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { CrewLeaveService } from '../crew-leave/crew-leave.service';
import { PrismaService } from '../prisma.service';
import { BookingClient } from '../booking-client.service';
import { FLEET_PROVIDER, type FleetProvider } from './fleet-provider';

const STATUS = ['Available', 'On Duty', 'Off Duty', 'On Leave'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const manilaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

function parseCapacityKg(value: unknown): number | null {
  const digits = String(value ?? '').replace(/[^\d]/g, '');
  return Number(digits) || null;
}

function vehicleDimensions(type?: string | null) {
  if (type === '6W 14ft. with Lifter') return '14 x 7 x 6 FT.';
  if (type === '10ft. Closed Van') return '10 x 6 x 6 FT.';
  if (type === '4W L300 FB Van') return `4W - 7'5" x 4 x 4 FT.`;
  return null;
}

function dateText(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text;
}

function formatRoute(deliveryLocation: unknown, pickupAddress: unknown, deliveryAddress: unknown) {
  const route = String(deliveryLocation ?? '').trim();
  if (route) return route;
  const pickup = String(pickupAddress ?? '').trim();
  const delivery = String(deliveryAddress ?? '').trim();
  return pickup || delivery ? `${pickup || 'Pickup not recorded'} → ${delivery || 'Delivery not recorded'}` : 'Route not recorded';
}

function required(value: unknown, name: string, max: number) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new BadRequestException(`Invalid ${name}`);
  return text;
}

/** Name, email and contact number belong to the account; Admin edits them in the portal (spec bms/0012). */
function refuseAccountFields(body: Record<string, unknown>) {
  if (['fullName', 'email', 'contact'].some((key) => body[key] !== undefined)) {
    throw new BadRequestException('Name, email and contact number are edited in the portal');
  }
}

function optionalText(value: unknown, name: string, max: number) {
  if (value === undefined) return undefined;
  return value === null || value === '' ? null : required(value, name, max);
}

function optionalDate(value: unknown, name: string) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  const text = String(value);
  const date = new Date(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new BadRequestException(`Invalid ${name}`);
  }
  return date;
}

@Injectable()
export class FleetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly directory: DirectoryClient,
    private readonly bookings: BookingClient,
    @Inject(FLEET_PROVIDER) private readonly provider: FleetProvider,
    @Optional() private readonly leave?: CrewLeaveService,
  ) {}

  /** Crew on approved leave, or on an emergency, today (spec bms/0003). */
  private async onLeaveToday(ids: string[]) {
    return this.leave ? this.leave.onLeave(manilaToday(), ids) : new Map();
  }

  garages() { return this.provider.garages(); }

  async vehicles() {
    const [rows, activeAssignments] = await Promise.all([
      this.provider.vehicles(),
      this.prisma.dispatchAssignment.findMany({
        where: { state: { in: ['PENDING', 'CONFIRMED', 'RELEASING'] }, serviceDate: manilaToday() }, select: { vehicleId: true },
      }),
    ]);
    const assigned = new Set(activeAssignments.map((item) => item.vehicleId));
    return rows.map((vehicle) => ({ ...vehicle, isAssigned: assigned.has(String(vehicle.id)) }));
  }

  /** View-only inventory from VMMS, enriched with BMS assignment details. */
  async vehicleAvailability() {
    const [vehicles, assignments, bookings, drivers, helpers] = await Promise.all([
      this.vehicles(),
      this.prisma.dispatchAssignment.findMany({
        where: { state: 'CONFIRMED', vehicleId: { not: null } },
        orderBy: [{ serviceDate: 'asc' }, { dispatchTime: 'asc' }],
      }),
      this.bookings.list(),
      this.provider.drivers(),
      this.helpers(),
    ]);
    const bookingById = new Map(bookings.map((booking) => [booking.id, booking]));
    const jobOrders = await this.prisma.dispatchJobOrder.findMany({
      where: { bookingUuid: { in: assignments.map((item) => item.bookingUuid) } },
      select: { bookingUuid: true, jobOrderNo: true },
    });
    const jobOrderByBooking = new Map(jobOrders.map((item) => [item.bookingUuid, item.jobOrderNo]));
    const driverById = new Map(drivers.map((item) => [item.id, item]));
    const helperById = new Map(helpers.map((item) => [item.id, item]));
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

    const realRows = vehicles.map((vehicle) => {
      const vehicleAssignments = assignments.filter((item) => item.vehicleId === vehicle.id);
      const primary = vehicleAssignments.find((item) => item.serviceDate >= today) ?? vehicleAssignments.at(-1);
      const currentBooking = primary ? bookingById.get(primary.bookingUuid) : undefined;
      const driver = primary?.driverId ? driverById.get(primary.driverId) : undefined;
      const assignedDriver = driver ?? (vehicle.driverId ? driverById.get(vehicle.driverId) : undefined);
      const assignedHelpers = primary ? primary.helperIds.map((id) => helperById.get(id)).filter(Boolean) : [];
      const upcomingSchedule = vehicleAssignments
        .filter((item) => item.serviceDate >= today && item.bookingUuid !== primary?.bookingUuid)
        .map((item) => {
          const booking = bookingById.get(item.bookingUuid);
          return {
            date: item.serviceDate,
            time: item.dispatchTime ?? booking?.preferredTime ?? '',
            bookingNumber: booking?.bookingNo ?? booking?.bookingId ?? '—',
            locationCode: ((booking as any)?.deliveryLocation ?? '').split(/[—–-]/, 1)[0].trim() || '—',
          };
        });
      return {
        ...vehicle,
        truckTypeId: vehicle.truckTypeId || vehicle.type || '',
        capacityKg: parseCapacityKg(vehicle.capacity),
        dimensions: vehicleDimensions(vehicle.truckTypeId || vehicle.type),
        requiredHelpersMin: vehicle.requiredHelpers,
        requiredHelpersMax: vehicle.requiredHelpers,
        driver: assignedDriver ? { id: assignedDriver.id, name: assignedDriver.fullName } : null,
        helpers: assignedHelpers.map((helper) => ({ id: helper!.id, name: helper!.fullName })),
        currentAssignment: primary && currentBooking ? {
          bookingNumber: currentBooking.bookingNo || currentBooking.bookingId,
          jobOrderNumber: jobOrderByBooking.get(primary.bookingUuid) ?? null,
          service: currentBooking.service,
          date: primary.serviceDate,
          startTime: primary.dispatchTime,
          endTime: null,
          route: formatRoute((currentBooking as any).deliveryLocation, currentBooking.pickupAddress, currentBooking.deliveryAddress),
        } : null,
        upcomingSchedule,
        statusDetails: vehicle.statusReason || vehicle.statusSince || vehicle.expectedBackAt || vehicle.statusRemarks ? {
          reason: vehicle.statusReason ?? null,
          since: dateText(vehicle.statusSince),
          expectedBack: dateText(vehicle.expectedBackAt),
          remarks: vehicle.statusRemarks ?? null,
        } : null,
      };
    });

    return realRows;
  }

  async vehicleAvailabilityDetails(id: string) {
    const vehicle = (await this.vehicleAvailability()).find((item) => item.id === id);
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    return vehicle;
  }

  async drivers() {
    const [rows, activeAssignments] = await Promise.all([
      this.provider.drivers(),
      this.prisma.dispatchAssignment.findMany({
        where: { state: { in: ['PENDING', 'CONFIRMED', 'RELEASING'] }, serviceDate: manilaToday() }, select: { driverId: true },
      }),
    ]);
    const assigned = new Set(activeAssignments.map((item) => item.driverId));
    const away = await this.onLeaveToday(rows.map((driver) => String(driver.id)));
    return rows.map((driver) => ({
      ...driver,
      status: away.has(String(driver.id)) ? 'On Leave' : assigned.has(String(driver.id)) ? 'On Duty' : driver.status || 'Available',
      ...(away.has(String(driver.id)) && { leaveUntil: away.get(String(driver.id)).endDate }),
    }));
  }

  /** Everyone who holds the Helper role in Auth, with their BMS details (spec bms/0012). */
  async helpers() {
    const [linked, activeAssignments] = await Promise.all([
      linkedCrew(this.prisma, this.directory, 'HELPER'),
      this.prisma.dispatchAssignment.findMany({ where: { state: { in: ['PENDING', 'CONFIRMED', 'RELEASING'] }, serviceDate: manilaToday() }, select: { helperIds: true } }),
    ]);
    const assigned = new Set(activeAssignments.flatMap((item) => item.helperIds));
    const away = await this.onLeaveToday(linked.map(({ row }) => row.id));
    return linked.map(({ row: helper, person }) => ({
      id: helper.id, ...accountFields(person),
      status: away.has(helper.id) ? 'On Leave' : assigned.has(helper.id) ? 'On Duty' : helper.crewStatus,
      ...(away.has(helper.id) && { leaveUntil: away.get(helper.id).endDate }),
      joinDate: helper.joinDate?.toISOString().slice(0, 10) ?? '',
      emergencyName: helper.emergencyName ?? '', emergencyContact: helper.emergencyContact ?? '',
      updatedAt: helper.updatedAt?.toISOString() ?? null,
    }));
  }

  /** `serviceDate` (YYYY-MM-DD) also blocks crew who are on leave that day (spec bms/0003). */
  /**
   * Checks the truck, driver and helpers for an assignment. A Subcon assignment passes null for the
   * vehicle and driver (the subcontractor brings them), so only its helpers are checked.
   */
  async checkAssignment(vehicleId: string | null, driverId: string | null, helperIds: string[], serviceDate?: string) {
    const subcon = vehicleId === null && driverId === null;
    if ((!subcon && (!uuid.test(vehicleId ?? '') || !uuid.test(driverId ?? ''))) || helperIds.some((id) => !uuid.test(id))) {
      throw new BadRequestException('Assignment requires persisted fleet and crew IDs');
    }
    let requiredHelpers = 1;
    let plateNumber: string | null = null;
    if (!subcon) {
      const { vehicle, driver } = await this.provider.assignmentResources(vehicleId!, driverId!);
      if (!vehicle || vehicle.status !== 'AVAILABLE') throw new ConflictException({code:'VEHICLE_UNAVAILABLE',message:'Vehicle is unavailable'});
      if (!driver || !['Available', 'On Duty'].includes(driver.status ?? 'Available')) {
        throw new BadRequestException('Driver is unavailable');
      }
      requiredHelpers = vehicle.requiredHelpers;
      plateNumber = vehicle.plateNumber;
    }
    if (new Set(helperIds).size !== helperIds.length || helperIds.length < Math.max(1, requiredHelpers)) {
      throw new BadRequestException('Required helpers are missing or duplicated');
    }
    // Only helpers who hold the role in Auth right now can be assigned.
    const crew = new Map((await linkedCrew(this.prisma, this.directory, 'HELPER')).map(({ row }) => [row.id, row]));
    const helpers = helperIds.map((id) => crew.get(id));
    if (helpers.some((h) => !h)) throw new BadRequestException('Helper is unavailable');
    // Helpers get the same manual-status check as drivers; before this, helper status was never checked.
    if (helpers.some((h) => !['Available', 'On Duty'].includes(h!.crewStatus || 'Available'))) throw new BadRequestException('Helper is unavailable');
    if (serviceDate && this.leave) await this.leave.assertAvailable(serviceDate, driverId, helperIds);
    return { plateNumber };
  }

  /** Saves the helper's BMS details only; name, email and contact number come from Auth. */
  async updateHelper(id: string, body: Record<string, unknown>) {
    refuseAccountFields(body);
    const helper = await this.prisma.helper.findUnique({ where: { id } });
    if (!helper?.isActive || !helper.userId) throw new NotFoundException('Helper not found');
    if (body.status !== undefined && !STATUS.includes(String(body.status))) throw new BadRequestException('Invalid status');
    await this.prisma.helper.update({ where: { id }, data: {
      ...(body.status !== undefined && { crewStatus: String(body.status) }),
      ...(body.joinDate !== undefined && { joinDate: optionalDate(body.joinDate, 'joinDate') }),
      ...(body.emergencyName !== undefined && { emergencyName: optionalText(body.emergencyName, 'emergencyName', 160) }),
      ...(body.emergencyContact !== undefined && { emergencyContact: optionalText(body.emergencyContact, 'emergencyContact', 80) }),
    } });
    return (await this.helpers()).find((item) => item.id === id);
  }

  /** Saves the driver's BMS details only; name, email and contact number come from Auth. */
  async updateDriver(id: string, body: Record<string, unknown>) {
    refuseAccountFields(body);
    if (!uuid.test(id)) throw new BadRequestException('Invalid driver ID');
    const current = (await this.provider.drivers()).find((driver) => driver.id === id);
    if (!current) throw new NotFoundException('Driver not found');
    if (body.status !== undefined && !STATUS.includes(String(body.status))) throw new BadRequestException('Invalid status');
    if (body.licenseNo !== undefined) optionalText(body.licenseNo, 'licenseNo', 50);
    if (body.licenseExpiry !== undefined) optionalDate(body.licenseExpiry, 'licenseExpiry');
    if (body.joinDate !== undefined) optionalDate(body.joinDate, 'joinDate');
    if (body.emergencyName !== undefined) optionalText(body.emergencyName, 'emergencyName', 160);
    if (body.emergencyContact !== undefined) optionalText(body.emergencyContact, 'emergencyContact', 80);
    return this.provider.updateDriver(id, body);
  }
}
