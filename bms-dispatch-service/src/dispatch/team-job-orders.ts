import { Injectable } from '@nestjs/common';
import type { DispatchAssignment, DispatchJobOrder } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { BookingClient, type BookingRecord } from '../booking-client.service';
import { FleetService } from '../fleet/fleet.service';

/**
 * The job orders a driver or helper sees in the mobile app (spec bms/0022). The shape matches what
 * the app stores in SQLite (`JobOrder` in welinc-mobile-bms/types/bms.ts).
 */
export type TeamJobOrder = {
  id: string; jobOrderNumber: string; bookingNumber: string;
  status: 'PENDING' | 'ONGOING' | 'COMPLETED';
  postServiceFormSubmitted: boolean;
  clientName: string; contactNumber: string;
  date: string; pickupTime: string; dispatchTime: string;
  driverId: string; driverName: string; helperIds: string[]; helperNames: string[];
  garage: string; vehicle: string;
  pickupArea: string; pickupAddress: string; deliveryArea: string; deliveryAddress: string;
  estimatedItems: number; itemDescription: string; customerInstruction: string;
  insured: boolean; paymentMethod: string;
  charges: { label: string; amount: number }[];
  downPayment: number;
};

/** The team member records linked to a login. One person can in principle hold both. */
export type TeamMemberIds = { driverId: string | null; helperId: string | null };

export type TeamNames = {
  drivers: Map<string, string>; helpers: Map<string, string>; vehicles: Map<string, string>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (value: unknown) => (value == null ? '' : String(value).trim());

function money(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(text(value).replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isCancelled(booking: Pick<BookingRecord, 'status'>) {
  return /^cancelled?$/i.test(text(booking.status));
}

/**
 * A booking or dispatch time as 24h "HH:mm", the format the app shows. Takes the first time in the
 * text, so "8:30 AM", "08:30", "8 AM" and "08:30 - 10:00" all work. Empty when there is none.
 */
export function clockTime(value: unknown): string {
  const match = /(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(AM|PM)?/i.exec(text(value));
  if (!match || (!match[2] && !match[3])) return '';
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  const half = match[3]?.toUpperCase();
  if (half) {
    if (hours < 1 || hours > 12) return '';
    hours = (hours % 12) + (half === 'PM' ? 12 : 0);
  }
  if (hours > 23 || minutes > 59) return '';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Charge lines that add up to the booking amount: one line per priced add-on, and the service for
 * the rest. If the add-ons alone exceed the amount, one line with the amount is shown instead.
 */
export function chargeLines(booking: Pick<BookingRecord, 'service' | 'amount' | 'additionalServicesAvailed'>) {
  const total = money(booking.amount);
  const addOns = (Array.isArray(booking.additionalServicesAvailed) ? booking.additionalServicesAvailed : [])
    .map((item: { name?: unknown; price?: unknown }) => ({ label: text(item?.name), amount: money(item?.price) }))
    .filter((item) => item.label && item.amount > 0);
  const addOnTotal = addOns.reduce((sum, item) => sum + item.amount, 0);
  const service = text(booking.service) || 'Service';
  if (addOnTotal > total) return [{ label: service, amount: total }];
  return [{ label: service, amount: Math.round((total - addOnTotal) * 100) / 100 }, ...addOns];
}

export function teamStatus(order: Pick<DispatchJobOrder, 'status'>, booking: Pick<BookingRecord, 'status'>): TeamJobOrder['status'] {
  if (/^completed$/i.test(text(booking.status))) return 'COMPLETED';
  return order.status === 'Distributed' ? 'ONGOING' : 'PENDING';
}

/** One job order card. `submitted` is filled by the app from Completion; dispatch doesn't know it. */
export function jobOrderCard(
  order: DispatchJobOrder, assignment: DispatchAssignment, booking: BookingRecord, names: TeamNames,
): TeamJobOrder {
  const subcon = assignment.deliveryType === 'Subcon';
  const driverId = assignment.driverId ?? '';
  return {
    id: order.bookingUuid,
    jobOrderNumber: order.jobOrderNo,
    bookingNumber: text(booking.bookingNo),
    status: teamStatus(order, booking),
    postServiceFormSubmitted: false,
    clientName: text(booking.client),
    contactNumber: text(booking.contact),
    date: /^\d{4}-\d{2}-\d{2}/.test(text(booking.date)) ? text(booking.date).slice(0, 10) : text(order.serviceDate).slice(0, 10),
    pickupTime: clockTime(booking.preferredTime),
    dispatchTime: clockTime(assignment.dispatchTime),
    driverId,
    driverName: driverId ? names.drivers.get(driverId) ?? 'Assigned driver' : subcon ? 'Subcontractor' : '',
    helperIds: assignment.helperIds,
    helperNames: assignment.helperIds.map((id) => names.helpers.get(id) ?? 'Assigned helper'),
    garage: text(assignment.garage),
    vehicle: assignment.vehicleId ? names.vehicles.get(assignment.vehicleId) ?? text(order.truck) : subcon ? 'Subcontractor truck' : text(order.truck),
    pickupArea: text(booking.pickupLandmark),
    pickupAddress: text(booking.pickupAddress),
    deliveryArea: text(booking.deliveryLandmark),
    deliveryAddress: text(booking.deliveryAddress),
    estimatedItems: Number.isInteger(booking.estimatedItems) ? Number(booking.estimatedItems) : 0,
    itemDescription: text(booking.itemDetails),
    customerInstruction: text(booking.specialInstructions),
    insured: booking.hasInsurance === true,
    paymentMethod: text(booking.requestedPaymentMethod),
    charges: chargeLines(booking),
    downPayment: money(booking.downpayment),
  };
}

@Injectable()
export class TeamJobOrdersService {
  constructor(private readonly prisma: PrismaService, private readonly bookings: BookingClient, private readonly fleet: FleetService) {}

  /** The active driver and helper records linked to this login, as `crew-leave/self` finds them. */
  async teamMember(userId: string): Promise<TeamMemberIds> {
    if (!UUID.test(userId)) return { driverId: null, helperId: null };
    const [driver, helper] = await Promise.all([
      this.prisma.driver.findFirst({ where: { userId, isActive: true, deletedAt: null }, select: { id: true } }),
      this.prisma.helper.findFirst({ where: { userId, isActive: true }, select: { id: true } }),
    ]);
    return { driverId: driver?.id ?? null, helperId: helper?.id ?? null };
  }

  /** Confirmed assignments that list this login as the driver or a helper. */
  private async assignments(member: TeamMemberIds) {
    const or = [
      ...(member.driverId ? [{ driverId: member.driverId }] : []),
      ...(member.helperId ? [{ helperIds: { has: member.helperId } }] : []),
    ];
    if (!or.length) return [];
    return this.prisma.dispatchAssignment.findMany({ where: { state: 'CONFIRMED', OR: or } });
  }

  /**
   * The bookings this login works on, split by role. Completion uses it to check that a post-service
   * form comes from the assigned driver, and to list that driver's forms (spec bms/0022).
   */
  async teamBookings(userId: string): Promise<{ driver: string[]; helper: string[] }> {
    const member = await this.teamMember(userId);
    const assignments = await this.assignments(member);
    return {
      driver: assignments.filter((item) => member.driverId && item.driverId === member.driverId).map((item) => item.bookingUuid),
      helper: assignments.filter((item) => member.helperId && item.helperIds.includes(member.helperId)).map((item) => item.bookingUuid),
    };
  }

  /** The signed-in team member's job orders: active, confirmed, not cancelled, newest service date first. */
  async mine(userId: string): Promise<{ jobOrders: TeamJobOrder[] }> {
    const assignments = await this.assignments(await this.teamMember(userId));
    if (!assignments.length) return { jobOrders: [] };
    const byBooking = new Map(assignments.map((item) => [item.bookingUuid, item]));
    const orders = await this.prisma.dispatchJobOrder.findMany({
      where: { bookingUuid: { in: [...byBooking.keys()] }, state: 'ACTIVE' },
    });
    if (!orders.length) return { jobOrders: [] };
    const wanted = new Set(orders.map((item) => item.bookingUuid));
    const [bookings, names] = await Promise.all([
      this.bookings.list().then((rows) => new Map(rows.filter((row) => wanted.has(row.id)).map((row) => [row.id, row]))),
      this.names(),
    ]);
    const jobOrders = orders.flatMap((order) => {
      const booking = bookings.get(order.bookingUuid);
      const assignment = byBooking.get(order.bookingUuid);
      return booking && assignment && !isCancelled(booking) ? [jobOrderCard(order, assignment, booking, names)] : [];
    });
    jobOrders.sort((a, b) => b.date.localeCompare(a.date) || a.jobOrderNumber.localeCompare(b.jobOrderNumber));
    return { jobOrders };
  }

  /**
   * Driver, helper and vehicle names for the cards. They come from Auth and VMMS; if either is down
   * the cards still load with placeholder names rather than failing the phone's whole sync.
   */
  private async names(): Promise<TeamNames> {
    const [drivers, helpers, vehicles] = await Promise.all([
      this.fleet.drivers().catch(() => []),
      this.fleet.helpers().catch(() => []),
      this.fleet.vehicles().catch(() => []),
    ]);
    return {
      drivers: new Map(drivers.map((item) => [String(item.id), item.fullName])),
      helpers: new Map(helpers.map((item) => [String(item.id), item.fullName])),
      vehicles: new Map(vehicles.map((item) => [String(item.id), `${item.plateNumber} ${item.alias ?? ''}`.trim()])),
    };
  }
}
