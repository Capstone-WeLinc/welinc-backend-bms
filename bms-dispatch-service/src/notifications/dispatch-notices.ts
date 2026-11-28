import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { NotificationInput } from './notification-outbox';

/** The notifications Dispatch raises (spec bms/0021). Dedupe keys name the event, so retries add nothing. */

type Db = Prisma.TransactionClient | PrismaService;
type Trip = { bookingUuid: string; bookingNo: string; client: string; date: string };
export type CrewMember = { userId: string; role: 'DRIVER' | 'HELPER' };

const trip = (item: Trip) => `${item.bookingNo} · ${item.client}`;
const dateRange = (start: string, end: string) => (start === end ? start : `${start} to ${end}`);
const leaveName = (kind: string) => (kind === 'EMERGENCY' ? 'emergency leave' : 'leave');

/** The auth accounts behind a driver and helpers (spec bms/0012). Crew with no linked account are skipped. */
export async function crewAccounts(db: Db, driverId: string | null, helperIds: string[]): Promise<CrewMember[]> {
  const [driver, helpers] = await Promise.all([
    driverId ? db.driver.findUnique({ where: { id: driverId }, select: { userId: true } }) : null,
    helperIds.length ? db.helper.findMany({ where: { id: { in: helperIds } }, select: { userId: true } }) : [],
  ]);
  return [
    ...(driver?.userId ? [{ userId: driver.userId, role: 'DRIVER' as const }] : []),
    ...helpers.flatMap((helper) => (helper.userId ? [{ userId: helper.userId, role: 'HELPER' as const }] : [])),
  ];
}

/**
 * A team was confirmed: Operations distributes the job order. Each person hears what happened to them
 * (spec bms/0023), comparing the new team with the previous one (the team being replaced, or the team a
 * reschedule released):
 * - on both teams in the same role: `crew.rescheduled` when the date or dispatch time changed, else nothing;
 * - only on the previous team: `crew.unassigned` (the trip was reassigned);
 * - new, or in a new role: `crew.assigned`.
 * With no previous team, everyone is assigned.
 */
export function assignedNotices(input: {
  booking: Trip; jobOrderNo: string; dispatchTime: string | null; commandId: string; actorId: string | null;
  crew: CrewMember[]; previous: CrewMember[] | null; scheduleChanged: boolean;
}): NotificationInput[] {
  const { booking, commandId, actorId } = input;
  const when = `${booking.date}${input.dispatchTime ? `, dispatch at ${input.dispatchTime}` : ''}`;
  const key = (member: CrewMember) => `${member.userId}:${member.role}`;
  const before = new Set((input.previous ?? []).map(key));
  const after = new Set(input.crew.map(key));
  const kept = input.crew.filter((member) => before.has(key(member)));
  const added = input.crew.filter((member) => !before.has(key(member)));
  // A person who only changed role is told about the new role, not that they left the trip.
  const stillOn = new Set(input.crew.map((member) => member.userId));
  const removed = (input.previous ?? []).filter((member) => !after.has(key(member)) && !stillOn.has(member.userId));
  return [
    {
      dedupeKey: `joborder.ready:${booking.bookingUuid}:${commandId}`, role: 'OPERATIONS', actorId,
      kind: 'joborder.ready', title: 'Job order ready to distribute',
      message: `${input.jobOrderNo} · ${trip(booking)} — ${booking.date}`, href: '/operations/job-order', bookingUuid: booking.bookingUuid,
    },
    ...added.map((member) => ({
      dedupeKey: `crew.assigned:${booking.bookingUuid}:${commandId}:${member.userId}`, userId: member.userId, actorId,
      kind: 'crew.assigned', title: member.role === 'DRIVER' ? "You're assigned as the driver of a trip" : "You're assigned as a helper on a trip",
      message: `${trip(booking)} — ${when}`, bookingUuid: booking.bookingUuid,
    })),
    ...(input.scheduleChanged ? kept : []).map((member) => ({
      dedupeKey: `crew.rescheduled:${booking.bookingUuid}:${commandId}:${member.userId}`, userId: member.userId, actorId,
      kind: 'crew.rescheduled', title: 'Your trip has a new schedule',
      message: `${booking.bookingNo} — ${when}`, bookingUuid: booking.bookingUuid,
    })),
    ...removed.map((member) => ({
      dedupeKey: `crew.unassigned:${booking.bookingUuid}:${commandId}:${member.userId}`, userId: member.userId, actorId,
      kind: 'crew.unassigned', title: 'Your trip was reassigned',
      message: `${trip(booking)} — ${booking.date}. Another team now has it.`, bookingUuid: booking.bookingUuid,
    })),
  ];
}

// Distributing a job order sends the team no notice: it is a web status for the office (spec bms/0023).

/**
 * Admin approved a cancellation: the released crew are off that trip. A reschedule sends nothing here;
 * the team hears when the booking is assigned again (spec bms/0023).
 */
export function tripChangedNotices(input: { eventId: string; bookingUuid: string; bookingNo: string; cancelled: true; crew: CrewMember[] }): NotificationInput[] {
  return input.crew.map((member) => ({
    dedupeKey: `crew.trip_changed:${input.eventId}:${member.userId}`, userId: member.userId,
    kind: 'crew.trip_changed', title: input.cancelled ? 'Your trip was cancelled' : 'Your trip was rescheduled',
    message: `${input.bookingNo} — you're no longer assigned to it.`, bookingUuid: input.bookingUuid,
  }));
}

type LeaveRow = { id: string; kind: string; crewType: string; crewName: string; startDate: string; endDate: string; reason: string; requestedBy: string };

/** A driver or helper filed leave: Admin reviews it (an emergency is already in effect). */
export function leaveFiledNotices(row: LeaveRow): NotificationInput[] {
  const who = `${row.crewName} (${row.crewType === 'HELPER' ? 'Helper' : 'Driver'})`;
  return [{
    dedupeKey: `approval.submitted:crew:${row.id}`, role: 'ADMIN', actorId: row.requestedBy,
    kind: 'approval.submitted', title: row.kind === 'EMERGENCY' ? 'Emergency leave needs review' : 'Leave request needs review',
    message: `${who} — ${dateRange(row.startDate, row.endDate)}: ${row.reason}`, href: '/admin/approvals?type=crew',
  }];
}

/** Admin decided a leave request: the crew member hears back. */
export function leaveDecidedNotices(row: LeaveRow & { status: string; decidedBy: string | null; decisionReason: string | null }): NotificationInput[] {
  const outcome = row.status === 'Rejected' ? 'rejected' : row.kind === 'EMERGENCY' ? 'confirmed' : 'approved';
  return [{
    dedupeKey: `approval.decided:crew:${row.id}`, userId: row.requestedBy, actorId: row.decidedBy,
    kind: 'approval.decided', title: `Your ${leaveName(row.kind)} was ${outcome}`,
    message: `${dateRange(row.startDate, row.endDate)}${outcome === 'rejected' && row.decisionReason ? ` — ${row.decisionReason}` : ''}`,
  }];
}

/** A crew member on leave still holds a trip that day: Operations reassigns it. */
export function conflictNotices(conflicts: Array<Record<string, unknown>>): NotificationInput[] {
  return conflicts.map((item) => ({
    dedupeKey: `crew.conflict:${String(item.requestId)}:${String(item.bookingUuid)}:${String(item.crewId)}`, role: 'OPERATIONS' as const,
    kind: 'crew.conflict', title: 'Crew conflict: reassign trip',
    message: `${String(item.bookingNo ?? 'A booking')} on ${String(item.serviceDate)} — ${String(item.crewName)} is on ${leaveName(String(item.kind))}`,
    href: '/operations/scheduling', bookingUuid: typeof item.bookingUuid === 'string' ? item.bookingUuid : null,
  }));
}
