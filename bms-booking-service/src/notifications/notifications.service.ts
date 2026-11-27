import { Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { MAX_BATCH, type NotificationInput } from './notification-input';

type Db = Prisma.TransactionClient | PrismaService;

/** How long a notification stays in the bell (spec bms/0021). */
export const KEEP_DAYS = 60;
/** The most the bell lists at once. */
export const LIST_LIMIT = 40;
const SWEEP_MS = 6 * 60 * 60 * 1000;

export type Viewer = { userId: string; roles: string[] };

/** The notifications a person sees: theirs, or their role's, minus the ones they caused themselves. */
export function visibleTo(viewer: Viewer, now = new Date()): Prisma.NotificationWhereInput {
  return {
    createdAt: { gte: new Date(now.getTime() - KEEP_DAYS * 86_400_000) },
    OR: [{ recipientUserId: viewer.userId }, { recipientRole: { in: viewer.roles } }],
    // `NOT actorId = me` would also drop rows with no actor (SQL null), so spell it out
    AND: [{ OR: [{ actorId: null }, { actorId: { not: viewer.userId } }] }],
  };
}

export function toRows(items: NotificationInput[]): Prisma.NotificationCreateManyInput[] {
  return items.map((item) => ({
    dedupeKey: item.dedupeKey,
    recipientRole: item.role ?? null,
    recipientUserId: item.userId ?? null,
    actorId: item.actorId ?? null,
    kind: item.kind,
    title: item.title,
    message: item.message,
    href: item.href ?? null,
    bookingUuid: item.bookingUuid ?? null,
  }));
}

/**
 * In-app notifications (spec bms/0021). Writers call `add` inside their own transaction, so a
 * notification exists exactly when the change it describes does. Dispatch and Completion deliver
 * theirs through `/internal/notifications`.
 */
@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep().catch(() => undefined), SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Adds notifications in the caller's transaction. A repeated dedupe key is skipped. */
  async add(db: Db, items: NotificationInput[]) {
    if (!items.length) return 0;
    const { count } = await db.notification.createMany({ data: toRows(items), skipDuplicates: true });
    return count;
  }

  /**
   * A batch from another BMS service. A booking that no longer exists is dropped from the link
   * (its notification is still kept), so a deleted booking never blocks the sender's outbox.
   */
  async receive(items: NotificationInput[]) {
    const batch = items.slice(0, MAX_BATCH);
    const ids = [...new Set(batch.map((item) => item.bookingUuid).filter((id): id is string => Boolean(id)))];
    const existing = ids.length
      ? new Set((await this.prisma.booking.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((row) => row.id))
      : new Set<string>();
    const checked = batch.map((item) => (item.bookingUuid && !existing.has(item.bookingUuid) ? { ...item, bookingUuid: null } : item));
    return { accepted: await this.add(this.prisma, checked) };
  }

  async list(viewer: Viewer) {
    const where = visibleTo(viewer);
    const [rows, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where, orderBy: { createdAt: 'desc' }, take: LIST_LIMIT,
        include: { reads: { where: { userId: viewer.userId }, select: { readAt: true } } },
      }),
      this.prisma.notification.count({ where: { ...where, reads: { none: { userId: viewer.userId } } } }),
    ]);
    return {
      unread,
      items: rows.map((row) => ({
        id: row.id, kind: row.kind, title: row.title, message: row.message, href: row.href,
        createdAt: row.createdAt.toISOString(), read: row.reads.length > 0,
      })),
    };
  }

  async markRead(id: string, viewer: Viewer) {
    const visible = await this.prisma.notification.findFirst({ where: { ...visibleTo(viewer), id }, select: { id: true } });
    if (!visible) throw new NotFoundException('Notification not found');
    await this.prisma.notificationRead.createMany({ data: [{ notificationId: id, userId: viewer.userId }], skipDuplicates: true });
    return { read: true };
  }

  async markAllRead(viewer: Viewer) {
    const unread = await this.prisma.notification.findMany({
      where: { ...visibleTo(viewer), reads: { none: { userId: viewer.userId } } }, select: { id: true },
    });
    if (unread.length) {
      await this.prisma.notificationRead.createMany({
        data: unread.map((row) => ({ notificationId: row.id, userId: viewer.userId })), skipDuplicates: true,
      });
    }
    return { read: unread.length };
  }

  /** Drops notifications (and their read marks) past the keep window. */
  async sweep(now = new Date()) {
    const { count } = await this.prisma.notification.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - KEEP_DAYS * 86_400_000) } },
    });
    return count;
  }
}
