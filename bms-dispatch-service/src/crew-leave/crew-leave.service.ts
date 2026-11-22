import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { BookingClient } from '../booking-client.service';
import { DirectoryClient } from '../auth/directory.client';

/**
 * Crew leave and emergency requests (specs bms/0003, bms/0005).
 *
 * A driver or helper files a request for themselves (from the bms-mobile app). A planned LEAVE
 * takes effect once Admin approves it; an EMERGENCY takes effect as soon as it is filed and Admin
 * confirms it afterwards.
 * "On leave" is always worked out from these requests, never written over the crew member's
 * manual status, so it ends by itself when the dates pass or the request is rejected/withdrawn.
 */

export type CrewType = 'DRIVER' | 'HELPER';
export type LeaveKind = 'LEAVE' | 'EMERGENCY';
type Row = {
  id: string; crewType: string; crewId: string; crewEmpId: string; crewName: string; kind: string;
  startDate: string; endDate: string; reason: string; status: string; requestedBy: string; requestedAt: Date;
  decidedBy: string | null; decidedAt: Date | null; decisionReason: string | null;
};

export const MAX_LEAVE_DAYS = 30;
const ACTIVE_ASSIGNMENT_STATES = ['PENDING', 'CONFIRMED', 'RELEASING'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const manilaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

function calendarDate(value: unknown, name: string) {
  const text = String(value ?? '');
  const parsed = new Date(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new BadRequestException(`Choose a valid ${name}`);
  }
  return text;
}

const daysBetween = (start: string, end: string) =>
  Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;

/** Prisma filter for requests that make a person unavailable: approved, or an emergency still waiting. */
export const IN_EFFECT = { OR: [{ status: 'Approved' }, { status: 'Requested', kind: 'EMERGENCY' }] };

const kindLabel = (kind: string) => (kind === 'EMERGENCY' ? 'Emergency' : 'Leave');
const crewLabel = (type: string) => (type === 'HELPER' ? 'Helper' : 'Driver');
const dateRange = (row: Pick<Row, 'startDate' | 'endDate'>) =>
  row.startDate === row.endDate ? row.startDate : `${row.startDate} to ${row.endDate}`;

@Injectable()
export class CrewLeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingClient,
    @Optional() private readonly directory?: DirectoryClient,
  ) {}

  /** The crew record linked to this login: an active driver first, then an active helper. */
  private async selfCrew(actor: string): Promise<{ type: CrewType; id: string; empId: string; name: string }> {
    if (UUID.test(actor)) {
      const driver = await this.prisma.driver.findFirst({ where: { userId: actor, isActive: true, deletedAt: null } });
      if (driver) return { type: 'DRIVER', id: driver.id, empId: driver.empId, name: driver.name };
      const helper = await this.prisma.helper.findFirst({ where: { userId: actor, isActive: true } });
      if (helper) return { type: 'HELPER', id: helper.id, empId: helper.empId, name: helper.name };
    }
    throw new ForbiddenException('Your login is not linked to an active driver or helper');
  }

  /** One of the signed-in crew member's own requests, with a named history. */
  async selfDetail(id: string, actor: string) {
    const crew = await this.selfCrew(actor);
    const detail = await this.approvalDetail(id);
    if (detail.crewId !== crew.id) throw new ForbiddenException('You can only view your own requests');
    const ids = [detail.requestedBy, detail.decidedBy ?? '', ...detail.audit.map((event) => event.actorId)].filter(Boolean);
    const people = this.directory ? await this.directory.lookup(ids).catch(() => new Map()) : new Map();
    const name = (personId?: string | null) => (personId ? people.get(personId)?.name : undefined) ?? 'Unknown user';
    return {
      ...detail,
      submittedByName: name(detail.requestedBy),
      decidedByName: detail.decidedBy ? name(detail.decidedBy) : null,
      audit: detail.audit.map((event) => ({ ...event, actorName: name(event.actorId) })),
    };
  }

  /** A driver or helper files a leave or an emergency for themselves. */
  async fileSelf(input: Record<string, unknown>, actor: string) {
    const kind = String(input.kind ?? '').toUpperCase();
    if (kind !== 'LEAVE' && kind !== 'EMERGENCY') throw new BadRequestException('Choose Leave or Emergency');
    const reason = String(input.reason ?? '').trim();
    if (!reason || reason.length > 500) throw new BadRequestException('A reason is required (500 characters or fewer)');

    const today = manilaToday();
    const startDate = kind === 'EMERGENCY' ? today : calendarDate(input.startDate, 'start date');
    const endDate = calendarDate(input.endDate ?? startDate, 'end date');
    if (kind === 'EMERGENCY' && input.startDate !== undefined && input.startDate !== today) {
      throw new BadRequestException('An emergency starts today');
    }
    if (startDate < today) throw new BadRequestException('Leave cannot start in the past');
    if (endDate < startDate) throw new BadRequestException('The end date must be on or after the start date');
    if (daysBetween(startDate, endDate) > MAX_LEAVE_DAYS) {
      throw new BadRequestException(`A request can cover at most ${MAX_LEAVE_DAYS} days; file another request for the rest`);
    }

    const person = await this.selfCrew(actor);
    const crewType = person.type;
    const crewId = person.id;

    return this.prisma.$transaction(async (tx) => {
      // One filer at a time per person, so two overlapping requests can't both pass the check.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew-leave:${crewId}`}, 0))`;
      const overlap = await tx.crewLeaveRequest.findFirst({ where: {
        crewId, status: { in: ['Requested', 'Approved'] }, startDate: { lte: endDate }, endDate: { gte: startDate },
      } });
      if (overlap) {
        throw new ConflictException(`You already have a ${kindLabel(overlap.kind).toLowerCase()} request for ${dateRange(overlap)}`);
      }
      const created = await tx.crewLeaveRequest.create({ data: {
        crewType, crewId, crewEmpId: person.empId, crewName: person.name, kind,
        startDate, endDate, reason, requestedBy: actor,
      } });
      await tx.crewLeaveEvent.create({ data: { requestId: created.id, actorId: actor, action: 'filed', reason } });
      return created;
    });
  }

  /** The signed-in crew member's own requests, newest first. */
  async selfList(actor: string) {
    const crew = await this.selfCrew(actor);
    return this.prisma.crewLeaveRequest.findMany({ where: { crewId: crew.id }, orderBy: { requestedAt: 'desc' }, take: 200 });
  }

  /** A crew member can withdraw their own request while it waits. Withdrawing an emergency ends it at once. */
  async withdrawSelf(id: string, actor: string) {
    if (!UUID.test(id)) throw new BadRequestException('Invalid request ID');
    const crew = await this.selfCrew(actor);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.crewLeaveRequest.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Request not found');
      if (current.crewId !== crew.id) throw new ForbiddenException('You can only withdraw your own requests');
      const changed = await tx.crewLeaveRequest.updateMany({ where: { id, status: 'Requested' }, data: {
        status: 'Withdrawn', decidedBy: actor, decidedAt: new Date(),
      } });
      if (changed.count !== 1) throw new ConflictException('Only waiting requests can be withdrawn');
      await tx.crewLeaveEvent.create({ data: { requestId: id, actorId: actor, action: 'withdrawn' } });
      return tx.crewLeaveRequest.findUniqueOrThrow({ where: { id } });
    });
  }

  /** Leave in effect on any day from `from` (default today) onward, for the Scheduling pickers. */
  async active(from = manilaToday()) {
    const start = calendarDate(from, 'date');
    const rows = await this.prisma.crewLeaveRequest.findMany({ where: { ...IN_EFFECT, endDate: { gte: start } }, orderBy: { startDate: 'asc' } });
    return rows.map((row) => ({
      id: row.id, crewType: row.crewType, crewId: row.crewId, crewName: row.crewName, kind: row.kind,
      startDate: row.startDate, endDate: row.endDate, status: row.status,
    }));
  }

  /** Crew ids on leave on one date. Used for the crew lists and the assignment check. */
  async onLeave(date: string, crewIds?: string[]) {
    const rows = await this.prisma.crewLeaveRequest.findMany({ where: {
      ...IN_EFFECT, startDate: { lte: date }, endDate: { gte: date }, ...(crewIds && { crewId: { in: crewIds } }),
    } });
    return new Map(rows.map((row) => [row.crewId, row]));
  }

  /** Blocks an assignment when its driver or any helper is on leave on the service date. */
  async assertAvailable(serviceDate: string, driverId: string, helperIds: string[]) {
    const date = String(serviceDate ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const away = await this.onLeave(date, [driverId, ...helperIds]);
    const first = [driverId, ...helperIds].map((id) => away.get(id)).find(Boolean);
    if (first) {
      throw new ConflictException({
        code: 'CREW_ON_LEAVE',
        message: `${first.crewName} is on ${first.kind === 'EMERGENCY' ? 'emergency leave' : 'leave'} until ${first.endDate}. Choose someone else.`,
      });
    }
  }

  /** Trips (today or later) that still have a crew member who is on leave that day. */
  async conflicts(requestId?: string) {
    const today = manilaToday();
    const leaves = await this.prisma.crewLeaveRequest.findMany({ where: {
      ...(requestId ? { id: requestId, status: { in: ['Requested', 'Approved'] } } : IN_EFFECT), endDate: { gte: today },
    } });
    if (!leaves.length) return [];
    const ids = [...new Set(leaves.map((leave) => leave.crewId))];
    const assignments = await this.prisma.dispatchAssignment.findMany({ where: {
      state: { in: ACTIVE_ASSIGNMENT_STATES }, serviceDate: { gte: today },
      OR: [{ driverId: { in: ids } }, { helperIds: { hasSome: ids } }],
    }, orderBy: [{ serviceDate: 'asc' }, { dispatchTime: 'asc' }] });
    const out: Array<Record<string, unknown>> = [];
    for (const trip of assignments) {
      const date = String(trip.serviceDate).slice(0, 10);
      for (const leave of leaves) {
        if (date < leave.startDate || date > leave.endDate) continue;
        if (trip.driverId !== leave.crewId && !trip.helperIds.includes(leave.crewId)) continue;
        out.push({
          bookingUuid: trip.bookingUuid, serviceDate: date, dispatchTime: trip.dispatchTime,
          crewType: leave.crewType, crewId: leave.crewId, crewName: leave.crewName,
          kind: leave.kind, requestId: leave.id, requestStatus: leave.status,
        });
      }
    }
    if (!out.length) return out;
    // Booking numbers make the warning readable; a lookup failure keeps the warning without them.
    const unique = [...new Set(out.map((item) => String(item.bookingUuid)))];
    const names = new Map<string, { bookingNo?: string; client?: string }>();
    await Promise.all(unique.map(async (id) => {
      try { const booking = await this.bookings.get(id); names.set(id, { bookingNo: booking.bookingNo, client: booking.client }); } catch { /* keep going */ }
    }));
    return out.map((item) => ({ ...item, ...names.get(String(item.bookingUuid)) }));
  }

  // ------------------------------------------------------------------ Approvals (internal)

  private queueItem(row: Row) {
    const kind = kindLabel(row.kind);
    return {
      id: row.id, type: 'crew', subtype: row.kind === 'EMERGENCY' ? 'emergency' : 'leave',
      bookingNo: row.crewEmpId, client: `${row.crewName} (${crewLabel(row.crewType)})`,
      summary: `${kind} ${dateRange(row)}: ${row.reason}`, amount: null,
      submittedAt: row.requestedAt.toISOString(), submittedBy: row.requestedBy,
      status: row.status, decisionReason: row.decisionReason,
      crewType: row.crewType, crewName: row.crewName, startDate: row.startDate, endDate: row.endDate,
    };
  }

  async approvalItems(status?: string) {
    if (String(status ?? '').toLowerCase() === 'history') {
      // Decided by Admin, or withdrawn by the crew member, for the Approvals History tab.
      const rows = await this.prisma.crewLeaveRequest.findMany({
        where: { status: { in: ['Approved', 'Rejected', 'Withdrawn'] } }, orderBy: { decidedAt: 'desc' }, take: 500,
      });
      return { items: rows.map((row) => ({
        ...this.queueItem(row), decidedBy: row.decidedBy, decidedAt: (row.decidedAt ?? row.requestedAt).toISOString(),
      })) };
    }
    const approvedOnly = String(status ?? '').toLowerCase() === 'approved';
    const rows = await this.prisma.crewLeaveRequest.findMany({
      where: { status: approvedOnly ? 'Approved' : 'Requested' },
      orderBy: approvedOnly ? { decidedAt: 'desc' } : { requestedAt: 'asc' },
      take: approvedOnly ? 200 : undefined,
    });
    return { items: rows.map((row) => this.queueItem(row)) };
  }

  async approvalDetail(id: string) {
    if (!UUID.test(id)) throw new BadRequestException('Invalid request ID');
    const row = await this.prisma.crewLeaveRequest.findUnique({ where: { id }, include: { events: { orderBy: { createdAt: 'asc' } } } });
    if (!row) throw new NotFoundException('Approval item not found');
    const { events, ...request } = row;
    return {
      ...request, submittedBy: request.requestedBy,
      audit: events.map((event) => ({ id: event.id, actorId: event.actorId, action: event.action, reason: event.reason, createdAt: event.createdAt })),
      affectedTrips: await this.conflicts(id),
    };
  }

  async decide(id: string, actor: string, decision: 'approve' | 'reject', reason = '') {
    if (!UUID.test(id)) throw new BadRequestException('Invalid request ID');
    const note = reason.trim();
    if (decision === 'reject' && !note) throw new BadRequestException('A rejection reason is required');
    if (note.length > 500) throw new BadRequestException('Reason must be 500 characters or fewer');
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.crewLeaveRequest.findUnique({ where: { id } });
      if (!current || current.status !== 'Requested') throw new ConflictException('This approval item has already been decided');
      if (current.requestedBy === actor) throw new ForbiddenException('You cannot decide your own submission');
      if (decision === 'approve' && current.endDate < manilaToday()) {
        throw new ConflictException('These leave dates have already passed; reject it instead');
      }
      const changed = await tx.crewLeaveRequest.updateMany({ where: { id, status: 'Requested' }, data: {
        status: decision === 'approve' ? 'Approved' : 'Rejected', decidedBy: actor, decidedAt: new Date(), decisionReason: note || null,
      } });
      if (changed.count !== 1) throw new ConflictException('This approval item has already been decided');
      const action = decision === 'reject' ? 'rejected' : current.kind === 'EMERGENCY' ? 'confirmed' : 'approved';
      await tx.crewLeaveEvent.create({ data: { requestId: id, actorId: actor, action, reason: note || null } });
      return tx.crewLeaveRequest.findUniqueOrThrow({ where: { id } });
    });
  }
}
