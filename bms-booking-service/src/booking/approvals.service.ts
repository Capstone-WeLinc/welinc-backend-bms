import {
  BadRequestException, ConflictException, ForbiddenException, Injectable,
  OnModuleDestroy, OnModuleInit, ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DirectoryClient } from '../auth/directory.client';
import { PrismaService } from '../prisma.service';
import { CustomerNotificationService } from './customer-notification.service';

type ApprovalType = 'booking' | 'collection' | 'refund';
type ChangeType = 'reschedule' | 'cancel';
type QueueItem = {
  id: string; type: ApprovalType; subtype: string | null; bookingId?: string;
  bookingNo: string; client: string; summary: string; amount: number | null;
  submittedAt: string; submittedBy: string; status: string; decisionReason?: string | null;
};

// Only these booking changes still need Admin approval. Older create, edit, and
// assignment rows stay in the database as history but are no longer surfaced.
const APPROVAL_CHANGE_TYPES: string[] = ['reschedule', 'cancel'];
const ACTIVE_CHANGE_STATUSES = new Set(['For Verification', 'For Plotting', 'Rescheduled', 'Assigned']);
const MANILA_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
});

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

@Injectable()
export class ApprovalsService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private processing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly customerNotifications: CustomerNotificationService,
    private readonly directory: DirectoryClient,
  ) {}

  private async userDetails(ids: string[]) {
    const users = await this.directory.lookup(ids);
    return new Map([...users].map(([id,user]) => [id,{name:user.erased ? 'Deleted user' : user.name,role:user.roles.join(', ')}]));
  }

  private async withSubmitterNames<T extends { submittedBy: string }>(items: T[]) {
    const users = await this.userDetails(items.map((item) => item.submittedBy));
    return items.map((item) => {
      const user = users.get(item.submittedBy);
      return { ...item, submittedByName: user?.name ?? 'Unknown user', submittedByRole: user?.role ?? 'Unknown role' };
    });
  }

  private async withCompletionNames(value: unknown) {
    const data = jsonObject(value);
    const audit = Array.isArray(data.audit) ? data.audit.map(jsonObject) : [];
    const ids = [data.submittedBy, data.requestedBy, data.recordedBy, data.decidedBy, ...audit.map((event) => event.actorId)]
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    const users = await this.userDetails(ids);
    const output: Record<string, unknown> = { ...data };
    for (const key of ['submittedBy', 'requestedBy', 'recordedBy', 'decidedBy'] as const) {
      const id = data[key];
      if (typeof id !== 'string') continue;
      const user = users.get(id);
      const nameKey = key === 'decidedBy' ? 'decidedByName' : key === 'recordedBy' ? 'recordedByName' : 'submittedByName';
      const roleKey = key === 'decidedBy' ? 'decidedByRole' : key === 'recordedBy' ? 'recordedByRole' : 'submittedByRole';
      output[nameKey] = user?.name ?? 'Unknown user';
      output[roleKey] = user?.role ?? 'Unknown role';
    }
    if (audit.length) output.audit = audit.map((event) => {
      const user = typeof event.actorId === 'string' ? users.get(event.actorId) : undefined;
      return { ...event, actorName: user?.name ?? 'Unknown user', actorRole: user?.role ?? 'Unknown role' };
    });
    return output;
  }

  onModuleInit() {
    void this.flushOutbox();
    this.timer = setInterval(() => void this.flushOutbox(), 5000);
    this.timer.unref?.();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async completion(path: string, init: RequestInit = {}) {
    const key = process.env.BMS_INTERNAL_SERVICE_KEY;
    if (!key || key.length < 32) throw new ServiceUnavailableException('Internal BMS service authentication is not configured');
    const root = process.env.COMPLETION_API_URL || 'http://127.0.0.1:3023';
    let response: Response;
    try {
      response = await fetch(new URL(path, root), {
        ...init,
        headers: { 'content-type': 'application/json', 'x-bms-service-key': key, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new ServiceUnavailableException('Completion approval service is unavailable');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = jsonObject(data).message;
      if (response.status === 409) throw new ConflictException(message || 'Approval item changed; refresh and retry');
      if (response.status === 400) throw new BadRequestException(message || 'Invalid approval request');
      if (response.status === 403) throw new ForbiddenException(message || 'This approval action is not allowed');
      throw new ServiceUnavailableException(message || 'Completion approval service is unavailable');
    }
    return data;
  }

  private async dispatch(path: string, body: unknown) {
    const key = process.env.BMS_INTERNAL_SERVICE_KEY;
    if (!key || key.length < 32) throw new Error('Internal BMS service authentication is not configured');
    const root = process.env.DISPATCH_API_URL || 'http://127.0.0.1:3022';
    const response = await fetch(new URL(path, root), {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-bms-service-key': key },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Dispatch service returned ${response.status}`);
  }

  async submitChange(bookingId: string, input: Record<string, unknown>, actor: string) {
    const type = String(input.type ?? '') as ChangeType;
    if (!APPROVAL_CHANGE_TYPES.includes(type)) throw new BadRequestException('Unsupported booking change type');
    const reason = String(input.reason ?? '').trim();
    if (type === 'cancel' && !reason) throw new BadRequestException('Cancellation reason is required');
    if (reason.length > 500) throw new BadRequestException('Reason must be 500 characters or fewer');
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new ConflictException('Booking not found');
    if (!ACTIVE_CHANGE_STATUSES.has(booking.status)) throw new ConflictException('This booking cannot be changed in its current status');
    const dispatchKey = process.env.BMS_INTERNAL_SERVICE_KEY;
    if (!dispatchKey || dispatchKey.length < 32) throw new ServiceUnavailableException('Internal BMS service authentication is not configured');
    const dispatchRoot = process.env.DISPATCH_API_URL || 'http://127.0.0.1:3022';
    try {
      const check = await fetch(new URL(`/internal/dispatch/booking-state/${booking.id}`, dispatchRoot), {
        headers: { 'x-bms-service-key': dispatchKey }, signal: AbortSignal.timeout(5000),
      });
      if (check.ok) {
        const state = jsonObject(await check.json());
        if (state.distributed === true) throw new ConflictException('A distributed trip cannot be changed');
      } else if (check.status !== 404) {
        throw new ServiceUnavailableException('Unable to check dispatch state');
      }
    } catch (error) {
      if (error instanceof ConflictException || error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Dispatch service is unavailable; the change request was not saved');
    }

    let before: Record<string, unknown> = {};
    let after: Record<string, unknown> = {};
    if (type === 'reschedule') {
      if (!isCalendarDate(input.date) || input.date === booking.date) throw new BadRequestException('Choose a new valid booking date');
      before = { date: booking.date };
      after = { date: input.date };
    } else {
      before = { status: booking.status, date: booking.date };
      after = { status: 'Cancelled' };
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const request = await tx.bookingChangeRequest.create({ data: {
          bookingUuid: booking.id, type, payloadBefore: before as Prisma.InputJsonValue,
          payloadAfter: after as Prisma.InputJsonValue, reason: reason || null,
          requestedBy: actor, bookingVersion: booking.version,
        } });
        await tx.approvalAuditEvent.create({ data: {
          itemType: 'booking', itemId: request.id, actorId: actor, action: 'submitted', reason: reason || null,
        } });
        return request;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This booking already has a pending change request');
      }
      throw error;
    }
  }

  private bookingQueueRows(): Promise<QueueItem[]> {
    return this.prisma.bookingChangeRequest.findMany({
      where: { status: 'Pending', type: { in: APPROVAL_CHANGE_TYPES } }, include: { booking: true }, orderBy: { requestedAt: 'asc' },
    }).then((requests) => requests.flatMap((request) => {
      const booking = request.booking;
      if (booking.status === 'Cancelled') return [];
      const after = jsonObject(request.payloadAfter);
      const summary = request.type === 'reschedule' ? 'Reschedule requested' : `Cancellation requested: ${request.reason ?? ''}`;
      return [{
        id: request.id, type: 'booking', subtype: request.type, bookingId: booking.id,
        bookingNo: booking.bookingNo, client: booking.client, summary,
        amount: asNumber(after.amount ?? booking.amount), submittedAt: request.requestedAt.toISOString(),
        submittedBy: request.requestedBy, status: request.status,
      }];
    }));
  }

  private async allPending(): Promise<QueueItem[]> {
    const [bookings, completion] = await Promise.all([
      this.bookingQueueRows(), this.completion('/internal/completion/approvals'),
    ]);
    const externalItems = jsonObject(completion).items;
    const combined = [...bookings, ...(Array.isArray(externalItems) ? externalItems as QueueItem[] : [])];
    return combined.sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());
  }

  private async allApproved(): Promise<QueueItem[]> {
    const [requests, completion] = await Promise.all([
      this.prisma.bookingChangeRequest.findMany({
        where: { status: 'Approved', type: { in: APPROVAL_CHANGE_TYPES } }, include: { booking: true }, orderBy: { decidedAt: 'desc' },
      }),
      this.completion('/internal/completion/approvals?status=approved'),
    ]);
    const bookings = requests.flatMap((request) => {
      const booking = request.booking;
      if (booking.status === 'Cancelled') return [];
      const after = jsonObject(request.payloadAfter);
      const summary = request.type === 'reschedule' ? 'Reschedule approved' : `Cancellation approved: ${request.reason ?? ''}`;
      return [{
        id: request.id, type: 'booking' as const, subtype: request.type, bookingId: booking.id,
        bookingNo: booking.bookingNo, client: booking.client, summary,
        amount: asNumber(after.amount ?? booking.amount), submittedAt: request.requestedAt.toISOString(),
        submittedBy: request.requestedBy, status: request.status, decisionReason: request.decisionReason,
      }];
    });
    const externalItems = jsonObject(completion).items;
    const combined = [...bookings, ...(Array.isArray(externalItems) ? externalItems as QueueItem[] : [])];
    return combined.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  }

  async list(query: Record<string, unknown>) {
    const approvedOnly = String(query.status ?? '').toLowerCase() === 'approved';
    const all = approvedOnly ? await this.allApproved() : await this.allPending();
    const type = String(query.type ?? 'all');
    const subtype = String(query.subtype ?? '');
    const search = String(query.search ?? '').trim().toLowerCase();
    const filtered = all.filter((item) => (type === 'all' || item.type === type)
      && (!subtype || item.subtype === subtype)
      && (!search || `${item.bookingNo} ${item.client} ${item.summary}`.toLowerCase().includes(search)));
    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const limit = Math.min(100, Math.max(1, Math.floor(Number(query.limit) || 10)));
    const pageItems = filtered.slice((page - 1) * limit, page * limit);
    return { items: await this.withSubmitterNames(pageItems), total: filtered.length, page, limit };
  }

  async counts() {
    const items = await this.allPending();
    const overdue = items.filter((item) => Date.now() - new Date(item.submittedAt).getTime() > 24 * 60 * 60 * 1000).length;
    return {
      total: items.length,
      booking: items.filter((item) => item.type === 'booking').length,
      collection: items.filter((item) => item.type === 'collection').length,
      refund: items.filter((item) => item.type === 'refund').length,
      overdue,
      oldestAt: items[0]?.submittedAt ?? null,
      collectionAmount: items.filter((item) => item.type === 'collection').reduce((sum, item) => sum + (item.amount ?? 0), 0),
      refundAmount: items.filter((item) => item.type === 'refund').reduce((sum, item) => sum + (item.amount ?? 0), 0),
    };
  }

  async detail(type: ApprovalType, id: string, actor: string, admin: boolean) {
    if (!['booking', 'collection', 'refund'].includes(type)) throw new BadRequestException('Unsupported approval type');
    if (type !== 'booking') {
      const result = await this.completion(`/internal/completion/approvals/${type}/${encodeURIComponent(id)}?actor=${encodeURIComponent(actor)}&admin=${admin}`);
      return this.withCompletionNames(result);
    }
    const item = await this.prisma.bookingChangeRequest.findUnique({ where: { id }, include: { booking: true } });
    if (!item || (admin && item.booking.status === 'Cancelled')) throw new ConflictException('Approval item not found');
    if (!admin && item.requestedBy !== actor) throw new ForbiddenException('You can only view your own submissions');
    const audit = await this.prisma.approvalAuditEvent.findMany({ where: { itemType: 'booking', itemId: id }, orderBy: { createdAt: 'asc' } });
    const users = await this.userDetails([...audit.map((event) => event.actorId), item.requestedBy, item.decidedBy ?? '']);
    const submitter = users.get(item.requestedBy);
    const decider = item.decidedBy ? users.get(item.decidedBy) : undefined;
    return {
      ...item, booking: item.booking,
      submittedByName: submitter?.name ?? 'Unknown user', submittedByRole: submitter?.role ?? 'Unknown role',
      decidedByName: decider?.name ?? 'Unknown user', decidedByRole: decider?.role ?? 'Unknown role',
      audit: audit.map((event) => {
        const user = users.get(event.actorId);
        return { ...event, actorName: user?.name ?? 'Unknown user', actorRole: user?.role ?? 'Unknown role' };
      }),
    };
  }

  async decide(type: ApprovalType, id: string, actor: string, decision: 'approve' | 'reject', reason = '') {
    if (!['booking', 'collection', 'refund'].includes(type)) throw new BadRequestException('Unsupported approval type');
    if (decision === 'reject' && !reason.trim()) throw new BadRequestException('A rejection reason is required');
    if (reason.length > 500) throw new BadRequestException('Reason must be 500 characters or fewer');
    if (type !== 'booking') return this.completion(`/internal/completion/approvals/${type}/${encodeURIComponent(id)}/${decision}`, {
      method: 'POST', body: JSON.stringify({ actor, reason }),
    });
    const request = await this.prisma.bookingChangeRequest.findUnique({ where: { id } });
    if (!request || !APPROVAL_CHANGE_TYPES.includes(request.type)) throw new ConflictException('Approval item not found');
    if (request.requestedBy === actor) throw new ForbiddenException('You cannot decide your own submission');
    if (request.status !== 'Pending') throw new ConflictException('This approval item has already been decided');
    if (decision === 'reject') {
      return this.prisma.$transaction(async (tx) => {
        const changed = await tx.bookingChangeRequest.updateMany({ where: { id, status: 'Pending' }, data: {
          status: 'Rejected', decidedBy: actor, decidedAt: new Date(), decisionReason: reason.trim(),
        } });
        if (changed.count !== 1) throw new ConflictException('This approval item has already been decided');
        await tx.approvalAuditEvent.create({ data: { itemType: 'booking', itemId: id, actorId: actor, action: 'rejected', reason: reason.trim() } });
        return tx.bookingChangeRequest.findUniqueOrThrow({ where: { id } });
      });
    }

    const after = jsonObject(request.payloadAfter);
    const eventType = request.type === 'cancel' ? 'BOOKING_CANCEL_APPROVED' : 'BOOKING_RESCHEDULE_APPROVED';
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await tx.booking.findUnique({ where: { id: request.bookingUuid } });
      if (!current || current.version !== request.bookingVersion) {
        throw new ConflictException('Booking changed since this request; ask CS to submit again');
      }
      if (current.status === 'Cancelled' || current.status === 'Completed') throw new ConflictException('Booking can no longer be changed');
      const pending = await tx.bookingChangeRequest.updateMany({ where: { id, status: 'Pending' }, data: {
        status: 'Approved', decidedBy: actor, decidedAt: new Date(), decisionReason: reason.trim() || null,
      } });
      if (pending.count !== 1) throw new ConflictException('This approval item has already been decided');

      const updateData: Prisma.BookingUpdateManyMutationInput = request.type === 'reschedule'
        ? { date: String(after.date), status: 'Rescheduled', operationalHold: false, assignmentReference: null, version: { increment: 1 } }
        : { status: 'Cancelled', operationalHold: false, assignmentReference: null, version: { increment: 1 } };
      const changed = await tx.booking.updateMany({ where: { id: current.id, version: current.version }, data: updateData });
      if (changed.count !== 1) throw new ConflictException('Booking changed since this request; ask CS to submit again');
      await tx.approvalAuditEvent.create({ data: { itemType: 'booking', itemId: id, actorId: actor, action: 'approved', reason: reason.trim() || null } });

      await tx.approvalOutbox.create({ data: {
        eventType, aggregateId: current.id,
        payload: {
          bookingUuid: current.id, bookingNo: current.bookingNo, type: request.type,
          requestedBy: request.requestedBy, decidedBy: actor,
          reason: request.reason, needsUpdate: false,
        } as Prisma.InputJsonValue,
      } });
      return tx.bookingChangeRequest.findUniqueOrThrow({ where: { id }, include: { booking: true } });
    });
    const before = jsonObject(request.payloadBefore);
    const noticeEmail = typeof before.email === 'string' ? before.email : result.booking.email;
    await this.customerNotifications.sendBookingUpdate(
      { ...result.booking, email: noticeEmail },
      request.type === 'cancel' ? 'cancelled' : 'rescheduled',
      typeof before.date === 'string' ? before.date : undefined,
    );
    void this.flushOutbox();
    return result;
  }

  async mine(actor: string) {
    const [bookingRequests, completion] = await Promise.all([
      this.prisma.bookingChangeRequest.findMany({ where: { requestedBy: actor, type: { in: APPROVAL_CHANGE_TYPES } }, include: { booking: true }, orderBy: { requestedAt: 'desc' } }),
      this.completion(`/internal/completion/approvals/mine?actor=${encodeURIComponent(actor)}`),
    ]);
    const bookingItems = bookingRequests.map((item) => ({
      id: item.id, type: 'booking', subtype: item.type, bookingId: item.bookingUuid,
      bookingNo: item.booking.bookingNo, client: item.booking.client,
      summary: item.type === 'cancel' ? `Cancellation requested: ${item.reason ?? ''}` : 'Reschedule requested',
      amount: asNumber(jsonObject(item.payloadAfter).amount ?? item.booking.amount),
      submittedAt: item.requestedAt.toISOString(), submittedBy: item.requestedBy,
      status: item.status, decisionReason: item.decisionReason,
    }));
    const external = jsonObject(completion).items;
    const merged = [...bookingItems, ...(Array.isArray(external) ? external as QueueItem[] : [])];
    const named = await this.withSubmitterNames(merged);
    return named
      .sort((a, b) => new Date(String(b.submittedAt)).getTime() - new Date(String(a.submittedAt)).getTime());
  }

  async withdraw(type: ApprovalType, id: string, actor: string) {
    if (type !== 'booking') return this.completion(`/internal/completion/approvals/${type}/${encodeURIComponent(id)}/withdraw`, {
      method: 'POST', body: JSON.stringify({ actor }),
    });
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.bookingChangeRequest.findUnique({ where: { id } });
      if (!current || current.requestedBy !== actor) throw new ForbiddenException('You can only withdraw your own submissions');
      const changed = await tx.bookingChangeRequest.updateMany({ where: { id, requestedBy: actor, status: 'Pending' }, data: {
        status: 'Withdrawn', decidedBy: actor, decidedAt: new Date(),
      } });
      if (changed.count !== 1) throw new ConflictException('Only pending submissions can be withdrawn');
      await tx.approvalAuditEvent.create({ data: { itemType: 'booking', itemId: id, actorId: actor, action: 'withdrawn' } });
      return tx.bookingChangeRequest.findUniqueOrThrow({ where: { id } });
    });
  }

  async resubmit(type: ApprovalType, id: string, actor: string, input: Record<string, unknown>) {
    if (type !== 'booking') return this.completion(`/internal/completion/approvals/${type}/${encodeURIComponent(id)}/resubmit`, {
      method: 'POST', body: JSON.stringify({ actor, input }),
    });
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.bookingChangeRequest.findUnique({ where: { id }, include: { booking: true } });
      if (!current || current.requestedBy !== actor) throw new ForbiddenException('You can only resubmit your own submissions');
      if (!APPROVAL_CHANGE_TYPES.includes(current.type)) throw new ConflictException('This request no longer needs approval');
      const reason = String(input.reason ?? current.reason ?? '').trim();
      if (current.status !== 'Rejected') throw new ConflictException('Only rejected submissions can be resubmitted');
      if (await tx.bookingChangeRequest.findFirst({ where: { bookingUuid: current.bookingUuid, status: 'Pending', id: { not: id } } })) {
        throw new ConflictException('Another booking request is already pending');
      }
      if (current.booking.version !== current.bookingVersion || current.booking.status === 'Cancelled') throw new ConflictException('Booking changed since this request; submit a new request');
      const after: Record<string, unknown> = current.type === 'cancel' ? { status: 'Cancelled' } : { date: String(input.date ?? jsonObject(current.payloadAfter).date ?? '') };
      if (current.type === 'cancel' && !reason) throw new BadRequestException('Cancellation reason is required');
      if (current.type === 'reschedule' && (!isCalendarDate(after.date) || after.date === current.booking.date)) throw new BadRequestException('Choose a new valid booking date');
      const before = Object.fromEntries(Object.keys(after).map((key) => [key, (current.booking as unknown as Record<string, unknown>)[key] ?? null]));
      const updated = await tx.bookingChangeRequest.update({ where: { id }, data: {
        payloadBefore: before as Prisma.InputJsonValue, payloadAfter: after as Prisma.InputJsonValue,
        reason: reason || current.reason, status: 'Pending', requestedAt: new Date(),
        decidedBy: null, decidedAt: null, decisionReason: null,
      } });
      await tx.approvalAuditEvent.create({ data: { itemType: 'booking', itemId: id, actorId: actor, action: 'resubmitted', reason: reason || null } });
      return updated;
    });
  }

  private async flushOutbox() {
    if (this.processing) return;
    this.processing = true;
    try {
      const pending = await this.prisma.approvalOutbox.findMany({ where: { processedAt: null }, orderBy: { createdAt: 'asc' }, take: 20 });
      for (const event of pending) {
        try {
          const body = { ...jsonObject(event.payload), eventId: event.id, eventType: event.eventType };
          const tasks: Promise<void>[] = [];
          if (event.eventType.startsWith('BOOKING_')) {
            tasks.push(this.dispatch(`/internal/dispatch/approvals/${event.id}`, body));
          }
          if (event.eventType === 'BOOKING_CANCEL_APPROVED') {
            tasks.push(this.completion(`/internal/completion/approvals/cancel-booking/${event.id}`, { method: 'POST', body: JSON.stringify(body) }).then(() => undefined));
          }
          await Promise.all(tasks);
          await this.prisma.approvalOutbox.update({ where: { id: event.id }, data: { processedAt: new Date(), lastError: null, attempts: { increment: 1 } } });
        } catch (error) {
          await this.prisma.approvalOutbox.update({ where: { id: event.id }, data: {
            attempts: { increment: 1 }, lastError: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown outbox error',
          } });
        }
      }
    } catch {
      // The next poll retries any event that could not be read or delivered.
    } finally { this.processing = false; }
  }
}
