import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CustomerNotificationService, type AssignedTeam } from './customer-notification.service';
import { CreateBookingDto, UpdateBookingDto } from './booking.dto';
import { verifyTrackingToken } from './tracking-token';
import { nextBookingNumber } from './booking-number';
import { NotificationsService } from '../notifications/notifications.service';
import { cancelledNotices, newBookingNotices, rescheduledNotices } from '../notifications/booking-notices';

function calendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// Details CS can change directly. The date goes through a reschedule request, which
// still needs Admin approval, and the amount stays out of the edit form.
const DIRECT_EDIT_FIELDS = [
  'client', 'fullName', 'service', 'preferredTime', 'address', 'pickupAddress', 'deliveryAddress',
  'contact', 'email', 'itemDetails', 'specialInstructions', 'permitRequired', 'notes', 'discrepancyNote', 'flagged',
] as const;
const ASSIGNED_JOB_FIELDS = ['service', 'preferredTime', 'address', 'pickupAddress', 'deliveryAddress'];

const toCents = (value: unknown) => Math.round(Number(value) * 100);

/**
 * Validates a downpayment against the booking amount. Returns the value to store (null clears it),
 * or undefined when the input does not change the stored downpayment.
 */
function parseDownpayment(raw: unknown, existing: { amount: Prisma.Decimal | null; downpayment: Prisma.Decimal | null }) {
  if (raw === undefined) return undefined;
  const text = raw === null ? '' : String(raw).trim();
  if (text && !/^\d{1,8}(?:\.\d{1,2})?$/.test(text)) throw new BadRequestException('Downpayment must be a peso amount with up to 2 decimals');
  const next = text && toCents(text) > 0 ? text : null;
  if (next !== null && existing.amount !== null && toCents(next) > toCents(existing.amount)) {
    throw new BadRequestException('Downpayment cannot exceed the booking amount');
  }
  const current = existing.downpayment === null ? null : toCents(existing.downpayment);
  if ((next === null ? null : toCents(next)) === current) return undefined;
  return next;
}

/** The truck and crew Dispatch sends with ConfirmAssignment, kept only if it is plain, short text. */
export function assignedTeam(value: unknown): AssignedTeam | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const text = (item: unknown) => (typeof item === 'string' && item.trim() ? item.trim().slice(0, 120) : undefined);
  const helperNames = Array.isArray(raw.helperNames) ? raw.helperNames.map(text).filter((name): name is string => Boolean(name)).slice(0, 10) : [];
  const team = { truck: text(raw.truck), driverName: text(raw.driverName), helperNames, dispatchTime: text(raw.dispatchTime) };
  return team.truck || team.driverName || helperNames.length ? team : undefined;
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

@Injectable()
export class BookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerNotifications: CustomerNotificationService,
    private readonly notifications: NotificationsService,
  ) {}

  list() { return this.prisma.booking.findMany({ orderBy: { createdAt: 'desc' } }); }

  async truckRates(locationCode: string, truckTypeId: string) {
    const rows = await this.prisma.truckRate.findMany({
      where: { locationCode, truckTypeId, isActive: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      truckTypeId: row.truckTypeId,
      locationCode: row.locationCode,
      name: row.name,
      dimensions: row.dimensions,
      inclusions: row.inclusions,
      rate: Number(row.rate6hr),
      imageUrl: row.imageUrl,
      isActive: row.isActive,
    }));
  }

  async get(id: string) {
    if (!uuid(id)) throw new BadRequestException('Invalid booking ID');
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  private async createRecord(tx: Prisma.TransactionClient, input: CreateBookingDto, status: string) {
    const now = new Date();
    return tx.booking.create({ data: {
      bookingId: `WL-${randomUUID()}`,
      bookingNo: await nextBookingNumber(tx, now),
      client: input.client.trim(),
      fullName: input.fullName ?? input.client.trim(),
      service: input.service.trim(),
      amount: input.amount,
      totalAmount: input.totalAmount,
      requestedPaymentMethod: input.paymentMethod,
      date: input.date,
      serviceType: input.serviceType,
      deliveryCategory: input.deliveryCategory,
      selectedTruck: input.selectedTruck ? input.selectedTruck as unknown as Prisma.InputJsonValue : Prisma.JsonNull,
      preferredTime: input.preferredTime,
      pickupAddress: input.pickupAddress,
      deliveryAddress: input.deliveryAddress,
      pickupLandmark: input.pickupLandmark,
      deliveryLandmark: input.deliveryLandmark,
      address: input.address ?? input.deliveryAddress,
      deliveryLocation: input.deliveryLocation,
      contact: input.contact,
      email: input.email,
      notes: input.notes,
      itemDetails: input.itemDetails,
      specialInstructions: input.specialInstructions,
      estimatedItems: input.estimatedItems,
      servicesAvailed: input.servicesAvailed ?? [],
      protectiveMaterials: input.protectiveMaterials ?? [],
      additionalServicesAvailed: (input.additionalServicesAvailed ?? []).map(({ name, price, cashCharge }) => ({ name, price, ...(cashCharge ? { cashCharge } : {}) })),
      hasInsurance: input.hasInsurance ?? false,
      permitRequired: input.permitRequired ?? false,
      status,
    } });
  }

  async create(input: CreateBookingDto, actor: string) {
    if (!calendarDate(input.date)) throw new BadRequestException('date must be YYYY-MM-DD');
    const booking = await this.prisma.$transaction(async (tx) => {
      const booking = await this.createRecord(tx, input, 'For Plotting');
      await tx.approvalAuditEvent.create({ data: {
        itemType: 'booking', itemId: booking.id, actorId: actor, action: 'created',
      } });
      await this.notifications.add(tx, newBookingNotices(booking, actor, false));
      return booking;
    });
    await this.customerNotifications.sendTrackingLink(booking);
    return booking;
  }

  async hasPendingChange(id: string) {
    if (!uuid(id)) throw new BadRequestException('Invalid booking ID');
    const pending = await this.prisma.bookingChangeRequest.findFirst({ where: { bookingUuid: id, status: 'Pending' }, select: { id: true } });
    return { pending: Boolean(pending) };
  }

  private async assertNotDistributed(id: string) {
    const key = process.env.BMS_INTERNAL_SERVICE_KEY;
    const root = process.env.DISPATCH_API_URL || 'http://127.0.0.1:3022';
    if (!key || key.length < 32) throw new ConflictException('Dispatch state cannot be checked; update was not applied');
    let response: Response;
    try { response = await fetch(new URL(`/internal/dispatch/booking-state/${id}`, root), { headers: { 'x-bms-service-key': key }, signal: AbortSignal.timeout(5000) }); }
    catch { throw new ConflictException('Dispatch service is unavailable; update was not applied'); }
    if (response.status === 404) return;
    if (!response.ok) throw new ConflictException('Dispatch state cannot be checked; update was not applied');
    if ((await response.json() as { distributed?: boolean }).distributed) throw new ConflictException('A distributed trip cannot be changed');
  }

  async updateDetails(id: string, input: Record<string, unknown>, actor: string) {
    const existing = await this.get(id);
    if (!['For Verification', 'For Plotting', 'Rescheduled', 'Assigned'].includes(existing.status)) {
      throw new ConflictException('This booking cannot be changed in its current status');
    }
    const raw = input.changes && typeof input.changes === 'object' && !Array.isArray(input.changes) ? input.changes as Record<string, unknown> : {};
    if (raw.date !== undefined) throw new BadRequestException('Use a reschedule request to change the booking date');
    if (raw.amount !== undefined) throw new BadRequestException('The booking amount cannot be changed here');
    const existingValues = existing as unknown as Record<string, unknown>;
    const changes: Record<string, unknown> = Object.fromEntries(DIRECT_EDIT_FIELDS.filter((field) => raw[field] !== undefined && raw[field] !== existingValues[field]).map((field) => [field, raw[field]]));
    const downpayment = parseDownpayment(raw.downpayment, existing);
    if (downpayment !== undefined) changes.downpayment = downpayment;
    if (!Object.keys(changes).length) throw new BadRequestException('Include at least one changed booking field');
    if ((await this.hasPendingChange(id)).pending) throw new ConflictException('This booking has a pending reschedule or cancellation request');
    // A downpayment does not touch the job order, so it can still be recorded after the trip is distributed.
    if (Object.keys(changes).some((field) => field !== 'downpayment')) await this.assertNotDistributed(id);
    const needsUpdate = existing.status === 'Assigned' && ASSIGNED_JOB_FIELDS.some((field) => changes[field] !== undefined);
    const saved = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.booking.updateMany({
        where: { id, version: existing.version },
        data: { ...changes, version: { increment: 1 } } as Prisma.BookingUpdateManyMutationInput,
      });
      if (updated.count !== 1) throw new ConflictException('Booking changed while this update was being applied');
      await tx.approvalAuditEvent.create({ data: {
        itemType: 'booking', itemId: id, actorId: actor, action: 'updated', reason: JSON.stringify(changes).slice(0, 500),
      } });
      const booking = await tx.booking.findUniqueOrThrow({ where: { id } });
      if (needsUpdate) await tx.approvalOutbox.create({ data: {
        eventType: 'BOOKING_EDIT_APPROVED', aggregateId: id,
        payload: { bookingUuid: id, bookingNo: booking.bookingNo, type: 'edit', requestedBy: actor, decidedBy: actor, reason: 'Customer Service update', needsUpdate: true } as Prisma.InputJsonValue,
      } });
      return booking;
    });
    await this.customerNotifications.sendBookingUpdate({ ...saved, email: existing.email }, 'edited');
    return saved;
  }

  async update(id: string, input: UpdateBookingDto, actor: string) {
    const existing = await this.get(id);
    if (input.expectedVersion !== existing.version) throw new ConflictException('Booking version changed; reload and retry');
    if (input.date !== undefined && !calendarDate(input.date)) throw new BadRequestException('date must be YYYY-MM-DD');
    if (input.status !== undefined && !['For Plotting', 'Rescheduled', 'Cancelled'].includes(input.status)) {
      throw new BadRequestException('This status is owned by another BMS workflow');
    }
    if (['Cancelled', 'Completed'].includes(existing.status)) throw new ConflictException('Completed or cancelled bookings cannot be changed');
    const material = (input.service !== undefined && input.service !== existing.service) ||
      (input.date !== undefined && input.date !== existing.date) ||
      (input.address !== undefined && input.address !== existing.address) ||
      (input.pickupAddress !== undefined && input.pickupAddress !== existing.pickupAddress) ||
      (input.deliveryAddress !== undefined && input.deliveryAddress !== existing.deliveryAddress) ||
      (input.permitRequired !== undefined && input.permitRequired !== existing.permitRequired) ||
      (input.status !== undefined && input.status !== existing.status);
    if (material && existing.status === 'Assigned') {
      const key = process.env.BMS_INTERNAL_SERVICE_KEY;
      const root = process.env.DISPATCH_API_URL || 'http://127.0.0.1:3022';
      if (!key || key.length < 32) throw new ConflictException('Dispatch state cannot be checked; update was not applied');
      let response: Response;
      try { response = await fetch(new URL(`/internal/dispatch/booking-state/${id}`, root), { headers: { 'x-bms-service-key': key }, signal: AbortSignal.timeout(5000) }); }
      catch { throw new ConflictException('Dispatch service is unavailable; update was not applied'); }
      if (!response.ok) throw new ConflictException('Dispatch state cannot be checked; update was not applied');
      if ((await response.json() as { distributed?: boolean }).distributed) throw new ConflictException('A distributed trip cannot be changed');
    }
    const data: Prisma.BookingUpdateManyMutationInput = { version: { increment: 1 } };
    for (const key of ['client', 'fullName', 'service', 'date', 'address', 'pickupAddress', 'deliveryAddress', 'contact', 'email', 'notes', 'itemDetails', 'specialInstructions', 'discrepancyNote', 'flagged'] as const) {
      if (input[key] !== undefined) (data as Record<string, unknown>)[key] = input[key];
    }
    if (input.permitRequired !== undefined) data.permitRequired = input.permitRequired;
    const downpayment = parseDownpayment(input.downpayment, existing);
    if (downpayment !== undefined) data.downpayment = downpayment;
    if (input.status !== undefined) data.status = input.status;
    else if (material && (existing.status !== 'Assigned' || input.date !== undefined)) data.status = 'Rescheduled';
    const updatedBooking = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.booking.updateMany({
        where: { id, version: input.expectedVersion },
        data,
      });
      if (updated.count !== 1) throw new ConflictException('Booking changed while this update was being applied');
      const saved = await tx.booking.findUniqueOrThrow({ where: { id } });
      await tx.approvalAuditEvent.create({ data: {
        itemType: 'booking', itemId: id, actorId: actor, action: 'admin_updated',
        reason: JSON.stringify(input).slice(0, 500),
      } });
      const directCancel = saved.status === 'Cancelled' && existing.status !== 'Cancelled';
      const directReschedule = saved.date !== existing.date && saved.status === 'Rescheduled';
      const assignedEditNeedsUpdate = existing.status === 'Assigned' && material && input.date === undefined &&
        ['service', 'preferredTime', 'address', 'pickupAddress', 'deliveryAddress', 'amount'].some((key) => (input as unknown as Record<string, unknown>)[key] !== undefined);
      if (assignedEditNeedsUpdate) await tx.approvalOutbox.create({ data: {
        eventType: 'BOOKING_EDIT_APPROVED', aggregateId: id,
        payload: { bookingUuid: id, bookingNo: saved.bookingNo, type: 'edit', requestedBy: actor, decidedBy: actor, reason: 'Admin direct update', needsUpdate: true } as Prisma.InputJsonValue,
      } });
      if (directCancel || directReschedule) await tx.approvalOutbox.create({ data: {
        eventType: directCancel ? 'BOOKING_CANCEL_APPROVED' : 'BOOKING_RESCHEDULE_APPROVED',
        aggregateId: id,
        payload: { bookingUuid: id, bookingNo: saved.bookingNo, type: directCancel ? 'cancel' : 'reschedule', requestedBy: actor, decidedBy: actor, reason: 'Admin direct update', needsUpdate: false } as Prisma.InputJsonValue,
      } });
      if (directCancel) await this.notifications.add(tx, cancelledNotices(saved, actor));
      else if (directReschedule) await this.notifications.add(tx, rescheduledNotices(saved, actor));
      return saved;
    });
    const changedDate = updatedBooking.date !== existing.date;
    const cancelled = updatedBooking.status === 'Cancelled' && existing.status !== 'Cancelled';
    const rescheduled = changedDate && updatedBooking.status === 'Rescheduled';
    const editableFields = ['client', 'fullName', 'service', 'date', 'preferredTime', 'amount', 'address', 'pickupAddress', 'deliveryAddress', 'contact', 'email', 'notes', 'itemDetails', 'specialInstructions', 'discrepancyNote', 'flagged', 'permitRequired'] as const;
    const inputValues = input as unknown as Record<string, unknown>;
    const existingValues = existing as unknown as Record<string, unknown>;
    const edited = editableFields.some((key) => inputValues[key] !== undefined &&
      JSON.stringify(inputValues[key]) !== JSON.stringify(existingValues[key]));
    if (cancelled || rescheduled || edited) {
      await this.customerNotifications.sendBookingUpdate(
        { ...updatedBooking, email: existing.email },
        cancelled ? 'cancelled' : rescheduled ? 'rescheduled' : 'edited',
        existing.date,
      );
    }
    return updatedBooking;
  }

  async getCustomerTracking(id: string, token: string) {
    let tokenIsValid = false;
    try { tokenIsValid = verifyTrackingToken(id, token); } catch { /* Missing tracking secret is treated as an invalid link. */ }
    if (!tokenIsValid) throw new NotFoundException('Tracking link is invalid or expired');
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) throw new NotFoundException('Tracking link is invalid or expired');

    let dispatch: { assignment?: Record<string, unknown> | null; jobOrder?: Record<string, unknown> | null } = {};
    const key = process.env.BMS_INTERNAL_SERVICE_KEY;
    const root = process.env.DISPATCH_API_URL || 'http://127.0.0.1:3022';
    if (key && key.length >= 32) {
      try {
        const response = await fetch(new URL(`/internal/dispatch/tracking/${id}`, root), {
          headers: { 'x-bms-service-key': key }, signal: AbortSignal.timeout(5000),
        });
        if (response.ok) dispatch = await response.json() as typeof dispatch;
      } catch { /* Booking tracking remains available when dispatch is temporarily offline. */ }
    }

    const assignment = dispatch.assignment;
    const jobOrder = dispatch.jobOrder;
    const helperNames = Array.isArray(assignment?.helperNames)
      ? assignment.helperNames.filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
      : [];
    const assigned = assignment?.driverAssigned === true && helperNames.length > 0;
    const distributed = assigned && String(jobOrder?.status ?? '') === 'Distributed';
    const delivered = booking.status === 'Completed';
    const cancelled = booking.status === 'Cancelled';
    const confirmed = booking.status !== 'For Verification';
    const assignmentTime = typeof assignment?.updatedAt === 'string' ? assignment.updatedAt : null;
    const distributedTime = typeof jobOrder?.updatedAt === 'string' ? jobOrder.updatedAt : null;
    const bookingTime = booking.createdAt.toISOString();
    const timeline = [
      { id: 'confirmed', title: 'Booking Confirmed', description: confirmed ? 'Your booking has been confirmed and scheduled.' : 'Your booking is waiting for confirmation.', state: confirmed ? 'complete' : 'current', timestamp: bookingTime },
      { id: 'assigned', title: 'Team Assigned', description: assigned ? `Driver: ${String(assignment?.driverName || 'Assigned driver')}${assignment?.driverContact ? ` - Contact: ${String(assignment.driverContact)}` : ''} - Helper${helperNames.length > 1 ? 's' : ''}: ${helperNames.join(', ')}` : 'Your team will appear here once a driver and helper are assigned.', state: cancelled ? 'upcoming' : assigned ? 'complete' : confirmed ? 'current' : 'upcoming', timestamp: assigned ? assignmentTime : null },
      { id: 'pickup', title: 'Pick-up in Progress', description: distributed ? 'Your job has been dispatched to the assigned team.' : 'Updates will appear when dispatch begins.', state: cancelled ? 'upcoming' : distributed ? 'complete' : 'upcoming', timestamp: distributedTime },
      { id: 'transit', title: 'In Transit', description: distributed ? 'Your assigned team is handling the delivery.' : 'Your shipment will appear here after dispatch.', state: cancelled ? 'upcoming' : delivered ? 'complete' : distributed ? 'current' : 'upcoming', timestamp: distributedTime },
      { id: 'delivery', title: 'Delivery', description: delivered ? 'Your booking has been completed.' : 'Delivery is not yet complete.', state: cancelled ? 'cancelled' : delivered ? 'complete' : 'upcoming', timestamp: delivered ? booking.updatedAt.toISOString() : null },
    ];
    const currentStatus = cancelled ? 'Cancelled' : delivered ? 'Delivered' : distributed ? 'In Transit' : assigned ? 'Team Assigned' : confirmed ? 'Confirmed' : 'Pending Approval';
    return {
      bookingNo: booking.bookingNo,
      client: booking.client,
      service: booking.service,
      date: booking.date,
      status: currentStatus,
      pickupAddress: booking.pickupAddress || booking.address || 'Not provided',
      deliveryAddress: booking.deliveryAddress || booking.address || 'Not provided',
      driver: assigned ? { name: String(assignment?.driverName || 'Assigned driver'), contact: String(assignment?.driverContact || '') } : null,
      vehicle: assigned ? String(assignment?.vehicleLabel || '') : null,
      supportEmail: process.env.CUSTOMER_SUPPORT_EMAIL || process.env.SMTP_USER || '',
      timeline,
      updatedAt: booking.updatedAt.toISOString(),
    };
  }

  async command(id: string, input: Record<string, unknown>) {
    if (!uuid(id)) throw new BadRequestException('Invalid booking ID');
    const commandId = input.commandId;
    const expectedVersion = input.expectedVersion;
    const kind = input.kind;
    const reference = input.reference;
    if (typeof commandId !== 'string' || !uuid(commandId) || !Number.isInteger(expectedVersion) ||
      typeof kind !== 'string' || !['ConfirmAssignment', 'ReleaseAssignment', 'ConfirmWorkCompletion', 'SetPaymentHold'].includes(kind)) {
      throw new BadRequestException('Invalid internal booking command');
    }
    if (['ConfirmAssignment', 'ReleaseAssignment'].includes(kind) && (typeof reference !== 'string' || !uuid(reference))) {
      throw new BadRequestException('Assignment reference is required');
    }
    if (kind === 'SetPaymentHold' && typeof input.paymentHold !== 'boolean') {
      throw new BadRequestException('paymentHold must be boolean');
    }
    // The team details only feed the customer email, so they stay out of the duplicate-command check:
    // a retry is still the same command even if a crew member's name was edited in between.
    const { team: rawTeam, ...commandInput } = input;
    const team = kind === 'ConfirmAssignment' ? assignedTeam(rawTeam) : undefined;
    const payloadHash = createHash('sha256').update(JSON.stringify({ id, input: commandInput })).digest('hex');
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))::text`;
      const previous = await tx.internalBookingCommand.findUnique({ where: { commandId } });
      if (previous) {
        if (previous.payloadHash !== payloadHash) throw new ConflictException('Command ID reused with different content');
        return { ...previous.result as object, duplicate: true };
      }
      const booking = await tx.booking.findUnique({ where: { id } });
      if (!booking) throw new NotFoundException('Booking not found');
      if (booking.version !== expectedVersion) throw new ConflictException('Booking version changed; reload and retry');
      let data: Prisma.BookingUpdateInput;
      switch (kind) {
        case 'ConfirmAssignment':
          if (!['For Plotting', 'Rescheduled'].includes(booking.status) || booking.operationalHold || booking.paymentHold) {
            throw new ConflictException('Booking cannot be assigned');
          }
          if (await tx.bookingChangeRequest.findFirst({ where: { bookingUuid: id, status: 'Pending' }, select: { id: true } })) {
            throw new ConflictException('This booking has a pending reschedule or cancellation request');
          }
          data = { status: 'Assigned', operationalHold: true, assignmentReference: reference as string, version: { increment: 1 } };
          break;
        case 'ReleaseAssignment':
          if (booking.assignmentReference !== reference || booking.status !== 'Assigned') {
            throw new ConflictException('Assignment does not match the active booking');
          }
          data = { status: 'For Plotting', operationalHold: false, assignmentReference: null, version: { increment: 1 } };
          break;
        case 'ConfirmWorkCompletion':
          if (booking.status !== 'Assigned' || !booking.operationalHold) {
            throw new ConflictException('Only assigned work can be completed');
          }
          data = { status: 'Completed', version: { increment: 1 } };
          break;
        default:
          if (booking.status === 'Cancelled' && input.paymentHold === false) {
            throw new ConflictException('Cancelled payment state requires review');
          }
          data = { paymentHold: input.paymentHold as boolean, version: { increment: 1 } };
      }
      const updated = await tx.booking.update({ where: { id }, data });
      if (kind === 'ConfirmAssignment' && typeof input.actor === 'string' && uuid(input.actor)) {
        await tx.approvalAuditEvent.create({ data: { itemType: 'booking', itemId: id, actorId: input.actor, action: 'assigned' } });
      }
      const result = { applied: true, duplicate: false, bookingId: id, version: updated.version, status: updated.status };
      await tx.internalBookingCommand.create({ data: {
        commandId, bookingUuid: id, kind, payloadHash, result: result as Prisma.InputJsonValue,
      } });
      return result;
    });
    if ('applied' in result && result.applied && !result.duplicate && (kind === 'ConfirmAssignment' || kind === 'ConfirmWorkCompletion')) {
      const booking = await this.get(id);
      await this.customerNotifications.sendTrackingStatusUpdate(booking, kind === 'ConfirmAssignment' ? 'Team assigned' : 'Delivered', team);
    }
    return result;
  }

  async notifyTrackingUpdate(id: string, update: string) {
    if (!uuid(id)) throw new BadRequestException('Invalid booking ID');
    if (!['Pick-up in Progress', 'In Transit', 'Delivered'].includes(update)) throw new BadRequestException('Invalid tracking update');
    const booking = await this.get(id);
    await this.customerNotifications.sendTrackingStatusUpdate(booking, update);
    return { sent: Boolean(booking.email) };
  }
}
