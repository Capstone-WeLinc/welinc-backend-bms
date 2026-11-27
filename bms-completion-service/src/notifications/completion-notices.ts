import type { Prisma } from '@prisma/client';
import type { NotificationInput } from './notification-outbox';

/** The notifications Completion raises (spec bms/0021). Dedupe keys name the event, so retries add nothing. */

type Money = Prisma.Decimal | number | string;
const peso = (value: Money) => `₱${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type CollectionRow = {
  id: string; bookingUuid: string; bookingNo: string; clientName: string; amount: Money; method: string;
  recordedBy: string; submittedAt: Date; status: string; decisionReason: string | null;
  verifiedBy: string | null; verifiedAt: Date | null; rejectedBy: string | null; rejectedAt: Date | null;
};
type RefundRow = {
  id: string; bookingUuid: string; bookingNo: string; clientName: string; amount: Money; reason: string;
  requestedBy: string; requestedAt: Date; status: string; decidedBy: string | null; decidedAt: Date | null; decisionReason: string | null;
};

/** CS recorded (or resubmitted) a collection: Admin verifies it. */
export function collectionSubmittedNotices(row: CollectionRow): NotificationInput[] {
  return [{
    dedupeKey: `approval.submitted:collection:${row.id}:${row.submittedAt.getTime()}`, role: 'ADMIN', actorId: row.recordedBy,
    kind: 'approval.submitted', title: 'Collection needs review',
    message: `${row.bookingNo} · ${row.clientName} — ${peso(row.amount)} by ${row.method}`,
    href: '/admin/approvals?type=collection', bookingUuid: row.bookingUuid,
  }];
}

/** CS asked for (or resubmitted) a refund: Admin decides it. */
export function refundSubmittedNotices(row: RefundRow): NotificationInput[] {
  return [{
    dedupeKey: `approval.submitted:refund:${row.id}:${row.requestedAt.getTime()}`, role: 'ADMIN', actorId: row.requestedBy,
    kind: 'approval.submitted', title: 'Refund needs review',
    message: `${row.bookingNo} · ${row.clientName} — ${peso(row.amount)}: ${row.reason}`,
    href: '/admin/approvals?type=refund', bookingUuid: row.bookingUuid,
  }];
}

/** Admin verified or rejected a collection: the CS user who recorded it hears back. */
export function collectionDecidedNotices(row: CollectionRow): NotificationInput[] {
  const verified = row.status === 'VERIFIED';
  const when = (verified ? row.verifiedAt : row.rejectedAt) ?? new Date();
  return [{
    dedupeKey: `approval.decided:collection:${row.id}:${row.status}:${when.getTime()}`, userId: row.recordedBy,
    actorId: verified ? row.verifiedBy : row.rejectedBy, kind: 'approval.decided',
    title: `Your collection was ${verified ? 'verified' : 'rejected'}`,
    message: `${row.bookingNo} · ${row.clientName} — ${peso(row.amount)}${!verified && row.decisionReason ? `: ${row.decisionReason}` : ''}`,
    href: '/cs/my-submissions', bookingUuid: row.bookingUuid,
  }];
}

/** Admin approved or rejected a refund: the CS user who asked hears back. */
export function refundDecidedNotices(row: RefundRow): NotificationInput[] {
  const approved = row.status !== 'Rejected';
  return [{
    dedupeKey: `approval.decided:refund:${row.id}:${(row.decidedAt ?? new Date()).getTime()}`, userId: row.requestedBy,
    actorId: row.decidedBy, kind: 'approval.decided',
    title: `Your refund request was ${approved ? 'approved' : 'rejected'}`,
    message: `${row.bookingNo} · ${row.clientName} — ${peso(row.amount)}${!approved && row.decisionReason ? `: ${row.decisionReason}` : ''}`,
    href: '/cs/my-submissions', bookingUuid: row.bookingUuid,
  }];
}

/** The work is done and its details are in: CS checks them before collecting. */
export function postServiceReadyNotices(row: { bookingUuid: string; bookingNo: string; client: string; confirmCommandId: string | null; finalizedBy: string | null }): NotificationInput[] {
  return [{
    dedupeKey: `postservice.ready:${row.bookingUuid}:${row.confirmCommandId ?? 'done'}`, role: 'CUSTOMER_SUPPORT', actorId: row.finalizedBy,
    kind: 'postservice.ready', title: 'Post-Service details ready to verify',
    message: `${row.bookingNo} · ${row.client}`, href: '/cs/post-service', bookingUuid: row.bookingUuid,
  }];
}
