import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { BookingClient } from '../booking-client.service';
import { DispatchClient } from '../dispatch-client.service';

const METHODS = ['Cash', 'BDO', 'GCash', 'Xendit'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const money = (value: Prisma.Decimal | string | number) => `₱${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cents = (value: Prisma.Decimal | string | number) => Math.round(Number(value) * 100);

function manilaDate(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function amount(value: unknown) {
  const text = String(value ?? '');
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(text) || Number(text) <= 0) throw new BadRequestException('Amount must be a positive peso value with at most two decimals');
  return new Prisma.Decimal(text);
}

/** Maps a booking's requested payment method onto a collection method, when it is clear. */
function suggestedMethod(value?: string | null) {
  const text = String(value ?? '').toLowerCase();
  if (/gcash/.test(text)) return 'GCash';
  if (/xendit/.test(text)) return 'Xendit';
  if (/\bbdo\b|bank/.test(text)) return 'BDO';
  if (/\bcod\b|cash/.test(text)) return 'Cash';
  return null;
}

export type CollectionDraft = {
  bookingUuid: string; bookingId: string; bookingNo: string; clientName: string; service: string;
  completedOn: string; amount: number; method: string | null; reference: string;
};

@Injectable()
export class CollectionsService {
  constructor(private readonly prisma: PrismaService, private readonly bookings: BookingClient, private readonly dispatch: DispatchClient) {}

  private async ensureCollectionReady(bookingUuid: string) {
    const [work, readyBookingUuids] = await Promise.all([
      this.prisma.workOutcome.findUnique({
        where: { bookingUuid },
        select: { status: true, arrivalTime: true, issueReported: true, issueDetails: true },
      }),
      this.dispatch.postServiceReadyBookingUuids(),
    ]);
    if (!work || work.status !== 'COMPLETED' || !work.arrivalTime?.trim() ||
      work.issueReported && !work.issueDetails?.trim() || !readyBookingUuids.includes(bookingUuid)) {
      throw new ConflictException('Complete and verify the required Post-Service details before recording a collection');
    }
  }

  async create(input: Record<string, unknown>, actor: string) {
    const idempotencyKey = String(input.idempotencyKey ?? '');
    if (!UUID.test(idempotencyKey)) throw new BadRequestException('idempotencyKey must be a UUID');
    const matches = (item: { bookingUuid: string; bookingIdAlias: string; amount: Prisma.Decimal; method: string; reference: string }) =>
      (String(input.bookingId) === item.bookingUuid || String(input.bookingId) === item.bookingIdAlias) &&
      cents(amount(input.amount)) === cents(item.amount) && String(input.method) === item.method && String(input.reference) === item.reference;
    const existing = await this.prisma.collection.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (!matches(existing)) throw new ConflictException('idempotencyKey was reused for different collection details');
      return existing;
    }
    const booking = await this.bookings.resolve(String(input.bookingId ?? ''));
    if (booking.status === 'Cancelled') throw new ConflictException('Cancelled booking requires payment review');
    await this.ensureCollectionReady(booking.id);
    const collectedAt = input.collectedAt ? new Date(String(input.collectedAt)) : new Date();
    if (!Number.isFinite(collectedAt.getTime()) || collectedAt.getTime() > Date.now() + 300000) throw new BadRequestException('Invalid collectedAt');
    const method = String(input.method ?? '');
    if (!METHODS.includes(method)) throw new BadRequestException('Invalid payment method');
    const reference = String(input.reference ?? '').trim();
    if (!reference || reference.length > 100) throw new BadRequestException('Payment reference is required');
    const value = amount(input.amount);
    const fleet = await this.dispatch.snapshot(booking.id);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`booking:${booking.id}`}, 0))`;
        const duplicate = await tx.collection.findUnique({ where: { idempotencyKey } });
        if (duplicate) {
          if (!matches(duplicate)) throw new ConflictException('idempotencyKey was reused for different collection details');
          return duplicate;
        }
        const active = await tx.collection.findMany({
          where: { bookingUuid: booking.id, status: { in: ['PENDING', 'VERIFYING', 'VERIFIED'] } },
        });
        const refunds = await tx.refund.findMany({
          where: { collectionId: { in: active.filter((item) => item.status === 'VERIFIED').map((item) => item.id) }, projectionState: 'SYNCED' },
        });
        const outstandingCents = active.reduce((sum, item) => sum + cents(item.amount), 0) -
          refunds.reduce((sum, item) => sum + cents(item.amount), 0);
        if (booking.amount !== null && outstandingCents + cents(value) > cents(booking.amount)) {
          throw new ConflictException(outstandingCents >= cents(booking.amount)
            ? 'Booking is already fully paid'
            : 'Collection exceeds the remaining booking balance');
        }
        const collection = await tx.collection.create({ data: {
          idempotencyKey, bookingUuid: booking.id, bookingIdAlias: booking.bookingId, bookingNo: booking.bookingNo,
          clientName: booking.client, ...fleet, amount: value, method, reference, collectedAt,
          businessDate: manilaDate(collectedAt), recordedBy: actor,
        } });
        await tx.approvalAuditEvent.create({ data: { itemType: 'collection', itemId: collection.id, actorId: actor, action: 'submitted' } });
        return collection;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = await this.prisma.collection.findUnique({ where: { idempotencyKey } });
        if (duplicate && matches(duplicate)) return duplicate;
        throw new ConflictException('idempotencyKey was reused for different collection details');
      }
      throw error;
    }
  }

  async eligibleBookings() {
    const [bookings, verified, refunds, completedWork, readyBookingUuids] = await Promise.all([
      this.bookings.list(),
      this.prisma.collection.findMany({ where: { status: 'VERIFIED' } }),
      this.prisma.refund.findMany({ where: { projectionState: 'SYNCED' } }),
      this.prisma.workOutcome.findMany({
        where: { status: 'COMPLETED', arrivalTime: { not: null } },
        select: { bookingUuid: true, issueReported: true, issueDetails: true },
      }),
      this.dispatch.postServiceReadyBookingUuids(),
    ]);
    const dispatchReady = new Set(readyBookingUuids);
    const postServiceComplete = new Set(completedWork
      .filter((work) => !work.issueReported || Boolean(work.issueDetails?.trim()))
      .map((work) => work.bookingUuid));
    const refundedByCollection = new Map<string, number>();
    for (const refund of refunds) {
      refundedByCollection.set(refund.collectionId, (refundedByCollection.get(refund.collectionId) ?? 0) + cents(refund.amount));
    }
    const paidByBooking = new Map<string, number>();
    for (const collection of verified) {
      const netAmount = cents(collection.amount) - (refundedByCollection.get(collection.id) ?? 0);
      paidByBooking.set(collection.bookingUuid, (paidByBooking.get(collection.bookingUuid) ?? 0) + netAmount);
    }
    return bookings.filter((booking) => booking.status !== 'Cancelled' &&
      dispatchReady.has(booking.id) && postServiceComplete.has(booking.id) &&
      (booking.amount === null || (paidByBooking.get(booking.id) ?? 0) < cents(booking.amount)));
  }

  /**
   * Daily Sales rows generated from verified Post-Service records: bookings ready for collection that have
   * no collection awaiting approval, with their remaining balance. Nothing is stored until CS submits them.
   */
  async drafts(actor?: string): Promise<CollectionDraft[]> {
    const eligible = await this.eligibleBookings();
    if (!eligible.length) return [];
    const ids = eligible.map((booking) => booking.id);
    const [active, work] = await Promise.all([
      this.prisma.collection.findMany({ where: { bookingUuid: { in: ids }, status: { in: ['PENDING', 'VERIFYING', 'VERIFIED'] } } }),
      this.prisma.workOutcome.findMany({ where: { bookingUuid: { in: ids } }, select: { bookingUuid: true, finalizedAt: true, updatedAt: true, finalizedBy: true } }),
    ]);
    const refunds = await this.prisma.refund.findMany({
      where: { collectionId: { in: active.filter((item) => item.status === 'VERIFIED').map((item) => item.id) }, projectionState: 'SYNCED' },
    });
    const awaitingApproval = new Set(active.filter((item) => item.status !== 'VERIFIED').map((item) => item.bookingUuid));
    const completedOn = new Map(work.map((item) => [item.bookingUuid, manilaDate(item.finalizedAt ?? item.updatedAt)]));
    // A record belongs to the CS user who verified its Post-Service; older records without one are shared.
    const verifiedBy = new Map(work.map((item) => [item.bookingUuid, item.finalizedBy]));
    return eligible
      .filter((booking) => booking.amount !== null && !awaitingApproval.has(booking.id) &&
        (!actor || !verifiedBy.get(booking.id) || verifiedBy.get(booking.id) === actor))
      .map((booking) => {
        const collected = active.filter((item) => item.bookingUuid === booking.id)
          .reduce((sum, item) => sum + cents(item.amount), 0) -
          refunds.filter((item) => active.some((c) => c.id === item.collectionId && c.bookingUuid === booking.id))
            .reduce((sum, item) => sum + cents(item.amount), 0);
        return {
          bookingUuid: booking.id, bookingId: booking.bookingId, bookingNo: booking.bookingNo,
          clientName: booking.client, service: booking.service,
          completedOn: completedOn.get(booking.id) ?? booking.date,
          amount: (cents(booking.amount!) - collected) / 100,
          method: suggestedMethod(booking.requestedPaymentMethod), reference: booking.bookingNo,
        };
      })
      .filter((row) => row.amount > 0)
      .sort((a, b) => b.completedOn.localeCompare(a.completedOn));
  }

  /**
   * Submits every Daily Sales draft as a pending collection for Admin approval. CS may set a method or
   * reference per booking; drafts without a valid method are left for CS to complete.
   */
  async submitDrafts(input: Record<string, unknown>, actor: string) {
    const overrides = new Map<string, { method?: unknown; reference?: unknown }>();
    for (const item of Array.isArray(input.items) ? input.items : []) {
      if (item && typeof item === 'object' && typeof (item as { bookingUuid?: unknown }).bookingUuid === 'string') {
        overrides.set((item as { bookingUuid: string }).bookingUuid, item as { method?: unknown; reference?: unknown });
      }
    }
    const submitted: string[] = [];
    const skipped: Array<{ bookingNo: string; reason: string }> = [];
    for (const draft of await this.drafts(actor)) {
      const override = overrides.get(draft.bookingUuid);
      const method = String(override?.method || draft.method || '');
      const reference = String(override?.reference ?? '').trim() || draft.reference;
      if (!METHODS.includes(method)) {
        skipped.push({ bookingNo: draft.bookingNo, reason: 'Choose a payment method' });
        continue;
      }
      try {
        // create() re-checks readiness and the remaining balance under the booking lock, so a double submit cannot add a duplicate.
        await this.create({
          idempotencyKey: randomUUID(), bookingId: draft.bookingUuid, amount: draft.amount.toFixed(2), method, reference,
        }, actor);
        submitted.push(draft.bookingNo);
      } catch (error) {
        if (!(error instanceof ConflictException || error instanceof BadRequestException)) throw error;
        skipped.push({ bookingNo: draft.bookingNo, reason: error.message });
      }
    }
    if (!submitted.length && !skipped.length) throw new ConflictException('There are no records to submit');
    return { submitted: submitted.length, bookingNos: submitted, skipped };
  }

  /** The CS user's Daily Sales worklist: drafts to submit, plus their collections awaiting Admin approval. */
  async worklist(actor: string, admin: boolean) {
    const [ready, awaiting] = await Promise.all([
      this.drafts(admin ? undefined : actor),
      this.prisma.collection.findMany({
        where: { status: { in: ['PENDING', 'VERIFYING'] }, ...(admin ? {} : { recordedBy: actor }) },
        orderBy: { submittedAt: 'desc' },
      }),
    ]);
    return {
      ready,
      awaiting: awaiting.map((item) => ({
        id: item.id, bookingId: item.bookingIdAlias, bookingNo: item.bookingNo, clientName: item.clientName,
        amount: Number(item.amount), method: item.method, reference: item.reference,
        submittedOn: manilaDate(item.submittedAt),
      })),
    };
  }

  pending() { return this.prisma.collection.findMany({ where: { status: { in: ['PENDING', 'VERIFYING'] } }, orderBy: { createdAt: 'desc' } }); }
  all() { return this.prisma.collection.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }); }
  pendingRefunds() { return this.prisma.refund.findMany({ where: { projectionState: 'PENDING' }, orderBy: { createdAt: 'desc' } }); }

  async requestRefund(collectionId: string, input: Record<string, unknown>, actor: string) {
    const collection = await this.prisma.collection.findUnique({ where: { id: collectionId } });
    if (!collection || collection.status !== 'VERIFIED') throw new ConflictException('Only verified collections can be refunded');
    const value = amount(input.amount);
    const reason = String(input.reason ?? '').trim();
    if (!reason || reason.length > 500) throw new BadRequestException('Refund reason is required');
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.refundRequest.findFirst({ where: { collectionId, status: 'Requested' } });
      if (existing) throw new ConflictException('A refund request is already pending for this payment');
      const [refunds, requests] = await Promise.all([
        tx.refund.findMany({ where: { collectionId } }),
        tx.refundRequest.findMany({ where: { collectionId, status: 'Requested' } }),
      ]);
      const reserved = refunds.reduce((sum, item) => sum + cents(item.amount), 0) + requests.reduce((sum, item) => sum + cents(item.amount), 0);
      if (reserved + cents(value) > cents(collection.amount)) throw new ConflictException('Refund exceeds the remaining collected amount');
      const request = await tx.refundRequest.create({ data: {
        collectionId, bookingUuid: collection.bookingUuid, bookingNo: collection.bookingNo,
        clientName: collection.clientName, amount: value, reason, requestedBy: actor,
      } });
      await tx.approvalAuditEvent.create({ data: { itemType: 'refund', itemId: request.id, actorId: actor, action: 'submitted', reason } });
      return request;
    });
  }

  async approvalItems(status?: string) {
    const approvedOnly = status?.toLowerCase() === 'approved';
    const [collections, refunds] = await Promise.all([
      this.prisma.collection.findMany({
        where: { status: approvedOnly ? 'VERIFIED' : { in: ['PENDING', 'VERIFYING'] } },
        orderBy: approvedOnly ? { verifiedAt: 'desc' } : { createdAt: 'asc' },
      }),
      this.prisma.refundRequest.findMany({
        where: { status: approvedOnly ? { in: ['Approved', 'Refunded'] } : 'Requested' },
        orderBy: approvedOnly ? { decidedAt: 'desc' } : { requestedAt: 'asc' },
      }),
    ]);
    return { items: [
      ...collections.map((item) => ({ id: item.id, type: 'collection', subtype: null, bookingNo: item.bookingNo, client: item.clientName, summary: approvedOnly ? `${item.method} collection verified` : `${item.method} receipt to verify`, amount: Number(item.amount), submittedAt: item.submittedAt.toISOString(), submittedBy: item.recordedBy, status: approvedOnly ? 'Verified' : item.status, decisionReason: item.decisionReason })),
      ...refunds.map((item) => ({ id: item.id, type: 'refund', subtype: null, bookingNo: item.bookingNo, client: item.clientName, summary: `${approvedOnly ? 'Refund approved' : 'Refund requested'}: ${item.reason}`, amount: Number(item.amount), submittedAt: item.requestedAt.toISOString(), submittedBy: item.requestedBy, status: item.status, decisionReason: item.decisionReason })),
    ] };
  }

  async approvalMine(actor: string) {
    const [collections, refunds] = await Promise.all([
      this.prisma.collection.findMany({ where: { recordedBy: actor }, orderBy: { createdAt: 'desc' } }),
      this.prisma.refundRequest.findMany({ where: { requestedBy: actor }, orderBy: { requestedAt: 'desc' } }),
    ]);
    return { items: [
      ...collections.map((item) => ({ id: item.id, type: 'collection', subtype: null, bookingNo: item.bookingNo, client: item.clientName, summary: `${item.method} collection`, amount: Number(item.amount), submittedAt: item.submittedAt.toISOString(), submittedBy: item.recordedBy, status: item.status === 'PENDING' || item.status === 'VERIFYING' ? 'Pending' : item.status === 'VERIFIED' ? 'Verified' : item.status === 'WITHDRAWN' ? 'Withdrawn' : 'Rejected', decisionReason: item.decisionReason })),
      ...refunds.map((item) => ({ id: item.id, type: 'refund', subtype: null, bookingNo: item.bookingNo, client: item.clientName, summary: `Refund requested: ${item.reason}`, amount: Number(item.amount), submittedAt: item.requestedAt.toISOString(), submittedBy: item.requestedBy, status: item.status === 'Requested' ? 'Pending' : item.status, decisionReason: item.decisionReason })),
    ] };
  }

  async approvalDetail(type: string, id: string, actor: string, admin: boolean) {
    const item = type === 'collection'
      ? await this.prisma.collection.findUnique({ where: { id } })
      : await this.prisma.refundRequest.findUnique({ where: { id }, include: { collection: true } });
    if (!item) throw new NotFoundException('Approval item not found');
    const owner = type === 'collection' ? (item as { recordedBy: string }).recordedBy : (item as { requestedBy: string }).requestedBy;
    if (!admin && owner !== actor) throw new ForbiddenException('You can only view your own submissions');
    const audit = await this.prisma.approvalAuditEvent.findMany({ where: { itemType: type, itemId: id }, orderBy: { createdAt: 'asc' } });
    return { ...item, audit };
  }

  async decideApproval(type: string, id: string, actor: string, decision: 'approve' | 'reject', reason = '') {
    if (decision === 'reject' && !reason.trim()) throw new BadRequestException('A rejection reason is required');
    if (type === 'collection') {
      const current = await this.prisma.collection.findUnique({ where: { id } });
      if (!current || !['PENDING', 'VERIFYING'].includes(current.status)) throw new ConflictException('This approval item has already been decided');
      if (current.recordedBy === actor) throw new ConflictException('You cannot decide your own submission');
      if (decision === 'approve') {
        const verified = await this.verify(id, actor);
        return verified;
      }
      return this.prisma.$transaction(async (tx) => {
        const changed = await tx.collection.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'REJECTED', rejectedBy: actor, rejectedAt: new Date(), decisionReason: reason.trim() } });
        if (changed.count !== 1) throw new ConflictException('This approval item has already been decided');
        await tx.approvalAuditEvent.create({ data: { itemType: type, itemId: id, actorId: actor, action: 'rejected', reason: reason.trim() } });
        return tx.collection.findUniqueOrThrow({ where: { id } });
      });
    }
    const request = await this.prisma.refundRequest.findUnique({ where: { id } });
    if (!request || request.status !== 'Requested') throw new ConflictException('This approval item has already been decided');
    if (request.requestedBy === actor) throw new ConflictException('You cannot decide your own submission');
    if (decision === 'reject') return this.prisma.$transaction(async (tx) => {
      const changed = await tx.refundRequest.updateMany({ where: { id, status: 'Requested' }, data: { status: 'Rejected', decidedBy: actor, decidedAt: new Date(), decisionReason: reason.trim() } });
      if (changed.count !== 1) throw new ConflictException('This approval item has already been decided');
      await tx.approvalAuditEvent.create({ data: { itemType: type, itemId: id, actorId: actor, action: 'rejected', reason: reason.trim() } });
      return tx.refundRequest.findUniqueOrThrow({ where: { id } });
    });
    const collection = await this.prisma.collection.findUnique({ where: { id: request.collectionId } });
    if (!collection || collection.status !== 'VERIFIED') throw new ConflictException('The linked collection is no longer verified');
    const now = new Date();
    const businessDate = manilaDate(now);
    const booking = await this.bookings.get(collection.bookingUuid);
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`date:${businessDate}`}, 0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`booking:${collection.bookingUuid}`}, 0))`;
      const current = await tx.refundRequest.findUnique({ where: { id } });
      if (!current || current.status !== 'Requested') throw new ConflictException('This approval item has already been decided');
      if (await tx.dailySubmission.findUnique({ where: { date: businessDate } })) throw new ConflictException('Sales for today were already submitted');
      const existingRefunds = await tx.refund.findMany({ where: { collectionId: collection.id } });
      if (existingRefunds.reduce((sum, item) => sum + cents(item.amount), 0) + cents(current.amount) > cents(collection.amount)) {
        throw new ConflictException('Refund exceeds the remaining collected amount');
      }
      const verified = await tx.collection.findMany({ where: { bookingUuid: collection.bookingUuid, status: 'VERIFIED' } });
      const allRefunds = await tx.refund.findMany({ where: { collectionId: { in: verified.map((item) => item.id) } } });
      const remaining = verified.reduce((sum, item) => sum + cents(item.amount), 0) - allRefunds.reduce((sum, item) => sum + cents(item.amount), 0) - cents(current.amount);
      const refund = await tx.refund.create({ data: {
        idempotencyKey: current.id, collectionId: collection.id, amount: current.amount, reason: current.reason,
        refundedAt: now, businessDate, approvedBy: actor, desiredPaymentHold: remaining > 0,
        paymentCommandId: randomUUID(), paymentExpectedVersion: booking.version,
      } });
      const changed = await tx.refundRequest.updateMany({ where: { id, status: 'Requested' }, data: {
        status: 'Approved', decidedBy: actor, decidedAt: now, refundId: refund.id,
      } });
      if (changed.count !== 1) throw new ConflictException('This approval item has already been decided');
      await tx.approvalAuditEvent.create({ data: { itemType: type, itemId: id, actorId: actor, action: 'approved' } });
      return refund;
    });
    const refund = await this.syncRefund(created);
    if (refund.projectionState === 'SYNCED') await this.prisma.refundRequest.update({ where: { id }, data: { status: 'Refunded' } });
    return this.prisma.refundRequest.findUniqueOrThrow({ where: { id } });
  }

  async changeApprovalStatus(type: string, id: string, actor: string, action: 'withdraw' | 'resubmit', input: Record<string, unknown> = {}) {
    if (type === 'collection') {
      const current = await this.prisma.collection.findUnique({ where: { id } });
      if (!current || current.recordedBy !== actor) throw new ForbiddenException('You can only change your own submissions');
      if (action === 'withdraw') return this.prisma.$transaction(async (tx) => {
        const changed = await tx.collection.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'WITHDRAWN' } });
        if (changed.count !== 1) throw new ConflictException('Only pending submissions can be withdrawn');
        await tx.approvalAuditEvent.create({ data: { itemType: type, itemId: id, actorId: actor, action: 'withdrawn' } });
        return tx.collection.findUniqueOrThrow({ where: { id } });
      });
      if (current.status !== 'REJECTED') throw new ConflictException('Only rejected submissions can be resubmitted');
      const method = String(input.method ?? current.method);
      const reference = String(input.reference ?? current.reference).trim();
      const value = input.amount === undefined ? current.amount : amount(input.amount);
      if (!METHODS.includes(method) || !reference || reference.length > 100) throw new BadRequestException('Valid payment method and reference are required');
      return this.prisma.$transaction(async (tx) => {
        const changed = await tx.collection.updateMany({ where: { id, status: 'REJECTED', recordedBy: actor }, data: {
          amount: value, method, reference, status: 'PENDING', submittedAt: new Date(), rejectedBy: null, rejectedAt: null, decisionReason: null,
        } });
        if (changed.count !== 1) throw new ConflictException('Only rejected submissions can be resubmitted');
        await tx.approvalAuditEvent.create({ data: { itemType: type, itemId: id, actorId: actor, action: 'resubmitted' } });
        return tx.collection.findUniqueOrThrow({ where: { id } });
      });
    }
    const current = await this.prisma.refundRequest.findUnique({ where: { id } });
    if (!current || current.requestedBy !== actor) throw new ForbiddenException('You can only change your own submissions');
    if (action === 'resubmit') {
      if (current.status !== 'Rejected') throw new ConflictException('Only rejected submissions can be resubmitted');
      const value = input.amount === undefined ? current.amount : amount(input.amount);
      const reason = String(input.reason ?? current.reason).trim();
      if (!reason || reason.length > 500) throw new BadRequestException('Refund reason is required');
      return this.prisma.$transaction(async (tx) => {
        const changed = await tx.refundRequest.updateMany({ where: { id, requestedBy: actor, status: 'Rejected' }, data: {
          amount: value, reason, status: 'Requested', requestedAt: new Date(), decidedBy: null, decidedAt: null, decisionReason: null, refundId: null,
        } });
        if (changed.count !== 1) throw new ConflictException('Only rejected submissions can be resubmitted');
        await tx.approvalAuditEvent.create({ data: { itemType: type, itemId: id, actorId: actor, action: 'resubmitted', reason } });
        return tx.refundRequest.findUniqueOrThrow({ where: { id } });
      });
    }
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.refundRequest.updateMany({ where: { id, status: 'Requested' }, data: { status: 'Withdrawn', decidedBy: actor, decidedAt: new Date() } });
      if (changed.count !== 1) throw new ConflictException('Only pending submissions can be withdrawn');
      await tx.approvalAuditEvent.create({ data: { itemType: type, itemId: id, actorId: actor, action: 'withdrawn' } });
      return tx.refundRequest.findUniqueOrThrow({ where: { id } });
    });
  }

  async retryRefund(id: string) {
    if (!UUID.test(id)) throw new BadRequestException('Invalid refund ID');
    const refund = await this.prisma.refund.findUnique({ where: { id } });
    if (!refund) throw new NotFoundException('Refund not found');
    const synced = refund.projectionState === 'SYNCED' ? refund : await this.syncRefund(refund);
    if (synced.projectionState === 'SYNCED') await this.prisma.refundRequest.updateMany({ where: { refundId: id, status: 'Approved' }, data: { status: 'Refunded' } });
    return synced;
  }

  async verify(id: string, actor: string) {
    if (!UUID.test(id)) throw new BadRequestException('Invalid collection ID');
    let collection = await this.prisma.collection.findUnique({ where: { id } });
    if (!collection) throw new NotFoundException('Collection not found');
    if (collection.recordedBy === actor) throw new ConflictException('You cannot verify your own submission');
    if (collection.status === 'VERIFIED') return collection;
    if (!['PENDING', 'VERIFYING'].includes(collection.status)) throw new ConflictException('Collection cannot be verified');
    if (collection.status === 'PENDING') {
      const booking = await this.bookings.get(collection.bookingUuid);
      const lockDate = collection.businessDate;
      const lockBooking = collection.bookingUuid;
      collection = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`date:${lockDate}`}, 0))`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`booking:${lockBooking}`}, 0))`;
        const current = await tx.collection.findUniqueOrThrow({ where: { id } });
        if (current.status !== 'PENDING') return current;
        const reserved = await tx.collection.findMany({ where: { bookingUuid: current.bookingUuid, status: { in: ['VERIFIED', 'VERIFYING'] } } });
        const refunded = await tx.refund.findMany({ where: { collectionId: { in: reserved.map((item) => item.id) }, projectionState: 'SYNCED' } });
        const paidCents = reserved.reduce((sum, item) => sum + cents(item.amount), 0) - refunded.reduce((sum, item) => sum + cents(item.amount), 0);
        if (booking.amount !== null && paidCents + cents(current.amount) > cents(booking.amount)) {
          throw new ConflictException('Collection exceeds the current booking amount');
        }
        return tx.collection.update({ where: { id }, data: {
          status: 'VERIFYING', verifiedBy: actor, verifiedAt: new Date(),
          paymentCommandId: randomUUID(), paymentExpectedVersion: booking.version,
        } });
      });
    }
    if (collection.status === 'VERIFIED') return collection;
    if (collection.status !== 'VERIFYING') throw new ConflictException('Collection cannot be verified');
    try {
      try {
        await this.bookings.command(collection.bookingUuid, {
          commandId: collection.paymentCommandId, expectedVersion: collection.paymentExpectedVersion,
          kind: 'SetPaymentHold', paymentHold: true,
        });
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
        const current = await this.bookings.get(collection.bookingUuid);
        if (current.status === 'Cancelled') throw error;
        collection = await this.prisma.collection.update({ where: { id }, data: {
          paymentCommandId: randomUUID(), paymentExpectedVersion: current.version,
        } });
        await this.bookings.command(collection.bookingUuid, {
          commandId: collection.paymentCommandId, expectedVersion: collection.paymentExpectedVersion,
          kind: 'SetPaymentHold', paymentHold: true,
        });
      }
    } catch (error) {
      await this.prisma.collection.update({ where: { id }, data: { projectionError: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown error' } });
      throw new ServiceUnavailableException('Collection is pending Booking confirmation; retry verification');
    }
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.collection.updateMany({ where: { id, status: 'VERIFYING' }, data: { status: 'VERIFIED', projectionError: null } });
      if (changed.count !== 1) throw new ConflictException('This collection has already been decided');
      await tx.approvalAuditEvent.create({ data: { itemType: 'collection', itemId: id, actorId: actor, action: 'verified' } });
      return tx.collection.findUniqueOrThrow({ where: { id } });
    });
  }

  async reject(id: string, actor: string, reason = '') {
    const collection = await this.prisma.collection.findUnique({ where: { id } });
    if (!collection) throw new NotFoundException('Collection not found');
    if (collection.recordedBy === actor) throw new ConflictException('You cannot reject your own submission');
    if (collection.status !== 'PENDING') throw new ConflictException('Only pending collections can be rejected');
    const decisionReason = reason.trim() || 'Rejected by admin';
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.collection.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'REJECTED', rejectedBy: actor, rejectedAt: new Date(), decisionReason } });
      if (changed.count !== 1) throw new ConflictException('Collection has already been decided');
      await tx.approvalAuditEvent.create({ data: { itemType: 'collection', itemId: id, actorId: actor, action: 'rejected', reason: decisionReason } });
      return tx.collection.findUniqueOrThrow({ where: { id } });
    });
  }

  async refund(collectionId: string, input: Record<string, unknown>, actor: string) {
    const idempotencyKey = String(input.idempotencyKey ?? '');
    if (!UUID.test(idempotencyKey)) throw new BadRequestException('idempotencyKey must be a UUID');
    const previous = await this.prisma.refund.findUnique({ where: { idempotencyKey } });
    if (previous) {
      if (previous.collectionId !== collectionId || cents(previous.amount) !== cents(amount(input.amount)) || previous.reason !== String(input.reason ?? '').trim()) {
        throw new ConflictException('idempotencyKey was reused for different refund details');
      }
      return previous.projectionState === 'SYNCED' ? previous : this.syncRefund(previous);
    }
    const collection = await this.prisma.collection.findUnique({ where: { id: collectionId } });
    if (!collection || collection.status !== 'VERIFIED') throw new ConflictException('Only verified collections can be refunded');
    const value = amount(input.amount);
    const reason = String(input.reason ?? '').trim();
    if (!reason || reason.length > 500) throw new BadRequestException('Refund reason is required');
    const now = new Date();
    const businessDate = manilaDate(now);
    const booking = await this.bookings.get(collection.bookingUuid);
    const refund = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`date:${businessDate}`}, 0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`booking:${collection.bookingUuid}`}, 0))`;
      const duplicate = await tx.refund.findUnique({ where: { idempotencyKey } });
      if (duplicate) {
        if (duplicate.collectionId !== collectionId || cents(duplicate.amount) !== cents(value) || duplicate.reason !== reason) {
          throw new ConflictException('idempotencyKey was reused for different refund details');
        }
        return duplicate;
      }
      if (await tx.dailySubmission.findUnique({ where: { date: businessDate } })) {
        throw new ConflictException('Sales for today were already submitted');
      }
      const existing = await tx.refund.findMany({ where: { collectionId } });
      if (existing.reduce((sum, item) => sum + cents(item.amount), 0) + cents(value) > cents(collection.amount)) {
        throw new ConflictException('Refund exceeds the remaining collected amount');
      }
      const verified = await tx.collection.findMany({ where: { bookingUuid: collection.bookingUuid, status: 'VERIFIED' } });
      const previousRefunds = await tx.refund.findMany({ where: { collectionId: { in: verified.map((item) => item.id) } } });
      const remaining = verified.reduce((sum, item) => sum + cents(item.amount), 0) - previousRefunds.reduce((sum, item) => sum + cents(item.amount), 0) - cents(value);
      const created = await tx.refund.create({ data: {
        idempotencyKey, collectionId, amount: value, reason, refundedAt: now, businessDate, approvedBy: actor,
        desiredPaymentHold: remaining > 0,
        paymentCommandId: randomUUID(), paymentExpectedVersion: booking.version,
      } });
      await tx.approvalAuditEvent.create({ data: { itemType: 'refund', itemId: created.id, actorId: actor, action: 'issued', reason } });
      return created;
    });
    return this.syncRefund(refund);
  }

  private async syncRefund(refund: { id: string; collectionId: string; paymentCommandId: string | null; paymentExpectedVersion: number | null; desiredPaymentHold: boolean }) {
    const collection = await this.prisma.collection.findUniqueOrThrow({ where: { id: refund.collectionId } });
    try {
      try {
        await this.bookings.command(collection.bookingUuid, {
          commandId: refund.paymentCommandId, expectedVersion: refund.paymentExpectedVersion,
          kind: 'SetPaymentHold', paymentHold: refund.desiredPaymentHold,
        });
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
        const current = await this.bookings.get(collection.bookingUuid);
        const verified = await this.prisma.collection.findMany({ where: { bookingUuid: collection.bookingUuid, status: 'VERIFIED' } });
        const refunds = await this.prisma.refund.findMany({ where: { collectionId: { in: verified.map((item) => item.id) } } });
        const remaining = verified.reduce((sum, item) => sum + cents(item.amount), 0) -
          refunds.reduce((sum, item) => sum + cents(item.amount), 0);
        refund = await this.prisma.refund.update({ where: { id: refund.id }, data: {
          paymentCommandId: randomUUID(), paymentExpectedVersion: current.version, desiredPaymentHold: remaining > 0,
        } });
        await this.bookings.command(collection.bookingUuid, {
          commandId: refund.paymentCommandId, expectedVersion: refund.paymentExpectedVersion,
          kind: 'SetPaymentHold', paymentHold: refund.desiredPaymentHold,
        });
      }
    } catch (error) {
      await this.prisma.refund.update({ where: { id: refund.id }, data: { projectionError: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown error' } });
      throw new ServiceUnavailableException('Refund is pending Booking confirmation; retry repair');
    }
    return this.prisma.refund.update({ where: { id: refund.id }, data: { projectionState: 'SYNCED', projectionError: null } });
  }

  async sales(submittedOnly = false) {
    const collections = await this.prisma.collection.findMany({ where: { status: 'VERIFIED' }, orderBy: { collectedAt: 'desc' } });
    const refunds = await this.prisma.refund.findMany({ where: { projectionState: 'SYNCED' }, orderBy: { refundedAt: 'desc' } });
    // Collections now reach Admin only through the CS Submit step, so every verified one is a submitted sale.
    const rows = collections.map((item) => this.saleRow(item, cents(item.amount), true));
    for (const refund of refunds) {
      const original = collections.find((item) => item.id === refund.collectionId);
      if (original) rows.push(this.saleRow(original, -cents(refund.amount), true, refund.id, refund.businessDate, refund.reason));
    }
    return rows.filter((row) => !submittedOnly || row.reportStatus === 'Submitted').sort((a, b) => b.date.localeCompare(a.date));
  }

  private saleRow(item: { id: string; bookingIdAlias: string; bookingNo: string; clientName: string; method: string; reference: string; businessDate: string;
    garage: string; deliveryType: string; plateNumber: string; assignedTeam: string }, value: number, submitted: boolean, id = item.id, date = item.businessDate, remarks = '') {
    const formatted = money(value / 100);
    const zero = money(0);
    return {
      id, bookingId: item.bookingIdAlias, bookingNo: item.bookingNo, clientName: item.clientName,
      date, garage: item.garage, type: item.deliveryType, plateNumber: item.plateNumber, assignedTeam: item.assignedTeam,
      amount: formatted, paymentRemarks: remarks, cashPayment: item.method === 'Cash' ? formatted : zero,
      bdoPayment: item.method === 'BDO' ? formatted : zero, gcashPayment: item.method === 'GCash' ? formatted : zero,
      xenditPayment: item.method === 'Xendit' ? formatted : zero, totalDailySales: formatted,
      dateOfPayment: date, traceNo: item.reference, checkedBy: '', notedBy: '', approvedBy: '',
      status: submitted ? 'Submitted' : 'Draft', reportStatus: submitted ? 'Submitted' : 'Draft',
    };
  }

  async summary(date = manilaDate(new Date())) {
    const rows = (await this.sales()).filter((item) => item.date === date);
    const sum = (field: 'cashPayment' | 'bdoPayment' | 'gcashPayment' | 'xenditPayment' | 'totalDailySales') =>
      money(rows.reduce((total, item) => total + Math.round(Number(item[field].replace(/[^0-9.-]/g, '')) * 100), 0) / 100);
    return { date, totalInHouse: rows.filter((item) => item.type === 'Inhouse' && !item.totalDailySales.includes('₱-')).length,
      totalSubcontracted: rows.filter((item) => item.type === 'Subcon' && !item.totalDailySales.includes('₱-')).length, totalCash: sum('cashPayment'),
      totalBdo: sum('bdoPayment'), totalGcash: sum('gcashPayment'), totalXendit: sum('xenditPayment'), totalSales: sum('totalDailySales') };
  }

  async submit(date: string, actor: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('Invalid date');
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`date:${date}`}, 0))`;
      const unsettledCollections = await tx.collection.count({ where: { businessDate: date, status: 'VERIFYING' } });
      const unsettledRefunds = await tx.refund.count({ where: { businessDate: date, projectionState: 'PENDING' } });
      if (unsettledCollections || unsettledRefunds) throw new ConflictException('Sales have pending payment updates; retry after repair');
      const verified = await tx.collection.count({ where: { businessDate: date, status: 'VERIFIED' } });
      const refunded = await tx.refund.count({ where: { businessDate: date, projectionState: 'SYNCED' } });
      if (!verified && !refunded) throw new ConflictException('No verified collections for this date');
      return tx.dailySubmission.upsert({ where: { date }, create: { date, submittedAt: new Date(), submittedBy: actor }, update: {} });
    });
    return { date, submitted: 1, total: (await this.sales(true)).filter((item) => item.date === date).length, submittedAt: row.submittedAt };
  }
}
