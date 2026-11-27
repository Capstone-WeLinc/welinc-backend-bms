import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

// Spec bms/0021. The same file lives in bms-dispatch-service and bms-completion-service: change both.

/** One notification for the booking service's bell, which owns them all. */
export type NotificationInput = {
  /** Same event, same key: a repeated delivery adds nothing. */
  dedupeKey: string;
  role?: 'ADMIN' | 'CUSTOMER_SUPPORT' | 'OPERATIONS' | 'DRIVER' | 'HELPER';
  userId?: string;
  /** The person who caused it; it isn't shown to them. */
  actorId?: string | null;
  kind: string;
  title: string;
  message: string;
  href?: string | null;
  bookingUuid?: string | null;
};

type Db = Prisma.TransactionClient | PrismaService;

export const FLUSH_MS = 5_000;
const LEASE_MS = 60_000;
const BATCH = 50;
const KEEP_DELIVERED_DAYS = 7;
const CLEANUP_MS = 6 * 60 * 60_000;

/** 10 s, 20 s, 40 s … after each failed delivery, at most 10 minutes. */
export function outboxDelayMs(attempts: number) {
  return Math.min(10 * 60_000, 10_000 * 2 ** Math.max(0, attempts - 1));
}

/**
 * Queues notifications in the caller's transaction, so they exist exactly when the change they
 * describe does. The timer below delivers them to the booking service.
 */
export async function queueNotifications(db: Db, items: NotificationInput[]) {
  if (!items.length) return;
  await db.notificationOutbox.createMany({ data: items.map((item) => ({ payload: item as unknown as Prisma.InputJsonValue })) });
}

class DeliveryError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
  /** Booking refused the content itself: sending it again won't help. */
  get refused() { return this.status === 400; }
}

@Injectable()
export class NotificationOutbox implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationOutbox.name);
  private timer?: NodeJS.Timeout;
  private flushing = false;
  private lastCleanup = 0;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.flush(), FLUSH_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async post(items: unknown[]) {
    const key = process.env.BMS_INTERNAL_SERVICE_KEY;
    if (!key || key.length < 32) throw new DeliveryError(0, 'Internal service identity is not configured');
    const root = process.env.BOOKING_API_URL || 'http://127.0.0.1:3021';
    let response: Response;
    try {
      response = await fetch(new URL('/internal/notifications', root), {
        method: 'POST', headers: { 'x-bms-service-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({ items }), signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new DeliveryError(0, 'Booking service unavailable');
    }
    if (!response.ok) throw new DeliveryError(response.status, `Booking service returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  /** Delivers due notifications. Rows are leased first, so two replicas never send the same one. */
  async flush(now = new Date()) {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const claimed = await this.prisma.$queryRaw<{ id: string; payload: unknown; attempts: number }[]>`
        UPDATE notification_outbox SET locked_until = ${new Date(now.getTime() + LEASE_MS)}
        WHERE id IN (
          SELECT id FROM notification_outbox
          WHERE status = 'PENDING' AND next_attempt_at <= ${now} AND (locked_until IS NULL OR locked_until < ${now})
          ORDER BY created_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED
        )
        RETURNING id, payload, attempts`;
      if (claimed.length) await this.deliver(claimed);
      if (now.getTime() - this.lastCleanup > CLEANUP_MS) {
        this.lastCleanup = now.getTime();
        await this.prisma.notificationOutbox.deleteMany({ where: {
          status: { in: ['DELIVERED', 'FAILED'] }, createdAt: { lt: new Date(now.getTime() - KEEP_DELIVERED_DAYS * 86_400_000) },
        } });
      }
    } catch (error) {
      this.logger.warn(`Notification outbox could not be read: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      this.flushing = false;
    }
  }

  private async deliver(rows: { id: string; payload: unknown; attempts: number }[]) {
    try {
      await this.post(rows.map((row) => row.payload));
      await this.prisma.notificationOutbox.updateMany({ where: { id: { in: rows.map((row) => row.id) } }, data: {
        status: 'DELIVERED', deliveredAt: new Date(), lockedUntil: null, lastError: null,
      } });
      return;
    } catch (error) {
      // One bad item must not hold the others back: send them one by one to find it
      if (!(error instanceof DeliveryError && error.refused) || rows.length === 1) {
        await this.failed(rows, error);
        return;
      }
    }
    for (const row of rows) await this.deliver([row]);
  }

  private async failed(rows: { id: string; attempts: number }[], error: unknown) {
    const message = (error instanceof Error ? error.message : 'Unknown delivery error').slice(0, 1000);
    const refused = error instanceof DeliveryError && error.refused;
    for (const row of rows) {
      const attempts = row.attempts + 1;
      await this.prisma.notificationOutbox.update({ where: { id: row.id }, data: {
        attempts, lastError: message, lockedUntil: null,
        status: refused ? 'FAILED' : 'PENDING',
        nextAttemptAt: new Date(Date.now() + outboxDelayMs(attempts)),
      } });
    }
    this.logger.warn(`${rows.length} notification(s) not delivered${refused ? ' and dropped' : ', will retry'}: ${message}`);
  }
}
