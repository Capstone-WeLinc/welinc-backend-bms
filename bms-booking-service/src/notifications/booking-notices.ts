import type { NotificationInput } from './notification-input';

/**
 * The notifications the booking service raises (spec bms/0021). Each dedupe key names the event,
 * so a retried request can't add the same notification twice.
 */

type BookingFacts = { id: string; bookingNo: string; client: string; date: string; version: number };
type ChangeFacts = { id: string; type: string; reason: string | null; requestedBy: string; payloadAfter: unknown };

const label = (booking: Pick<BookingFacts, 'bookingNo' | 'client'>) => `${booking.bookingNo} · ${booking.client}`;
const changeName = (type: string) => (type === 'cancel' ? 'Cancellation' : 'Reschedule');
const afterDate = (payload: unknown) => {
  const date = payload && typeof payload === 'object' ? (payload as { date?: unknown }).date : undefined;
  return typeof date === 'string' ? date : null;
};

/** A new booking: Operations schedules it; Admin also hears about ones that came from the WeLinc site. */
export function newBookingNotices(booking: BookingFacts, actorId: string | null, fromWelinc: boolean): NotificationInput[] {
  return [
    ...(fromWelinc ? [{
      dedupeKey: `booking.received:${booking.id}`, role: 'ADMIN' as const, actorId,
      kind: 'booking.received', title: 'New booking received from WeLinc', message: label(booking),
      href: '/admin/booking', bookingUuid: booking.id,
    }] : []),
    {
      dedupeKey: `booking.needs_assignment:${booking.id}:v${booking.version}`, role: 'OPERATIONS', actorId,
      kind: 'booking.needs_assignment', title: 'Booking needs team assignment',
      message: `${label(booking)} — service date ${booking.date}`, href: '/operations/scheduling', bookingUuid: booking.id,
    },
  ];
}

/** A booking moved to a new date: its old team was released, so Operations assigns one again. */
export function rescheduledNotices(booking: BookingFacts, actorId: string | null): NotificationInput[] {
  return [{
    dedupeKey: `booking.rescheduled:${booking.id}:v${booking.version}`, role: 'OPERATIONS', actorId,
    kind: 'booking.needs_assignment', title: 'Rescheduled booking needs team assignment',
    message: `${label(booking)} — new date ${booking.date}`, href: '/operations/scheduling', bookingUuid: booking.id,
  }];
}

/** A booking was cancelled: Operations takes it off the schedule. */
export function cancelledNotices(booking: BookingFacts, actorId: string | null): NotificationInput[] {
  return [{
    dedupeKey: `booking.cancelled:${booking.id}`, role: 'OPERATIONS', actorId,
    kind: 'booking.cancelled', title: 'Booking cancelled', message: label(booking),
    href: '/operations/scheduling', bookingUuid: booking.id,
  }];
}

/** CS asked to reschedule or cancel: Admin reviews it. */
export function changeSubmittedNotices(request: ChangeFacts & { requestedAt: Date }, booking: BookingFacts): NotificationInput[] {
  const detail = request.type === 'cancel'
    ? (request.reason ? ` — ${request.reason}` : '')
    : (afterDate(request.payloadAfter) ? ` — to ${afterDate(request.payloadAfter)}` : '');
  return [{
    dedupeKey: `approval.submitted:booking:${request.id}:${request.requestedAt.getTime()}`, role: 'ADMIN',
    actorId: request.requestedBy, kind: 'approval.submitted', title: `${changeName(request.type)} needs review`,
    message: `${label(booking)}${detail}`, href: '/admin/approvals?type=booking', bookingUuid: booking.id,
  }];
}

/** Admin decided a reschedule or cancellation: the person who asked hears back. */
export function changeDecidedNotices(
  request: ChangeFacts & { status: string; decidedBy: string | null; decidedAt: Date | null; decisionReason: string | null },
  booking: BookingFacts,
): NotificationInput[] {
  const approved = request.status === 'Approved';
  return [{
    dedupeKey: `approval.decided:booking:${request.id}:${(request.decidedAt ?? new Date()).getTime()}`,
    userId: request.requestedBy, actorId: request.decidedBy, kind: 'approval.decided',
    title: `Your ${changeName(request.type).toLowerCase()} request was ${approved ? 'approved' : 'rejected'}`,
    message: `${label(booking)}${!approved && request.decisionReason ? ` — ${request.decisionReason}` : ''}`,
    href: '/cs/my-submissions', bookingUuid: booking.id,
  }];
}

/** A WeLinc change arrived for a booking that is already dispatched, paid or closed: Admin decides. */
export function welincBlockedNotices(eventId: string, booking: Pick<BookingFacts, 'id' | 'bookingNo' | 'client'>): NotificationInput[] {
  return [{
    dedupeKey: `welinc.blocked:${eventId}`, role: 'ADMIN', kind: 'welinc.change_blocked',
    title: 'WeLinc booking change needs review',
    message: `${label(booking)} — the booking is already dispatched, paid or closed`,
    href: '/admin/booking', bookingUuid: booking.id,
  }];
}
