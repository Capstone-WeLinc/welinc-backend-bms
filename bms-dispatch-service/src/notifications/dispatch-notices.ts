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

/** A team was confirmed: Operations distributes the job order, and each crew member hears they're on it. */
export function assignedNotices(input: {
  booking: Trip; jobOrderNo: string; dispatchTime: string | null; commandId: string; actorId: string | null;
  crew: CrewMember[]; removed: CrewMember[];
}): NotificationInput[] {
  const { booking, commandId, actorId } = input;
  const when = `${booking.date}${input.dispatchTime ? `, dispatch at ${input.dispatchTime}` : ''}`;
  return [
    {
      dedupeKey: `joborder.ready:${booking.bookingUuid}:${commandId}`, role: 'OPERATIONS', actorId,
      kind: 'joborder.ready', title: 'Job order ready to distribute',
      message: `${input.jobOrderNo} · ${trip(booking)} — ${booking.date}`, href: '/operations/job-order', bookingUuid: booking.bookingUuid,
    },
    ...input.crew.map((member) => ({
      dedupeKey: `crew.assigned:${booking.bookingUuid}:${commandId}:${member.userId}`, userId: member.userId, actorId,
      kind: 'crew.assigned', title: member.role === 'DRIVER' ? "You're assigned as the driver of a trip" : "You're assigned as a helper on a trip",
      message: `${trip(booking)} — ${when}`, bookingUuid: booking.bookingUuid,
    })),
    ...input.removed.map((member) => ({
      dedupeKey: `crew.unassigned:${booking.bookingUuid}:${commandId}:${member.userId}`, userId: member.userId, actorId,
      kind: 'crew.unassigned', title: 'You were removed from a trip',
      message: `${trip(booking)} — ${booking.date}. Another team now has it.`, bookingUuid: booking.bookingUuid,
    })),
  ];
}

/** The job order went out: the crew can start the trip. */
export function distributedNotices(input: {
  booking: Trip; jobOrderNo: string; dispatchTime: string | null; commandId: string; crew: CrewMember[];
}): NotificationInput[] {
  const { booking } = input;
  return input.crew.map((member) => ({
    dedupeKey: `crew.dispatched:${booking.bookingUuid}:${input.commandId}:${member.userId}`, userId: member.userId,
    kind: 'crew.dispatched', title: 'Job order distributed',
    message: `${input.jobOrderNo} · ${trip(booking)} — ${booking.date}${input.dispatchTime ? `, dispatch at ${input.dispatchTime}` : ''}`,
    bookingUuid: booking.bookingUuid,
  }));
}

/** Admin approved a cancellation or reschedule: the released crew are off that trip. */
export function tripChangedNotices(input: { eventId: string; bookingUuid: string; bookingNo: string; cancelled: boolean; crew: CrewMember[] }): NotificationInput[] {
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
