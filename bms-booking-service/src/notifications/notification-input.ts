import { BadRequestException } from '@nestjs/common';

/** Who a notification can be for (spec bms/0021). Drivers and helpers read theirs from the mobile app later. */
export const NOTIFY_ROLES = ['ADMIN', 'CUSTOMER_SUPPORT', 'OPERATIONS', 'DRIVER', 'HELPER'] as const;
export type NotifyRole = (typeof NOTIFY_ROLES)[number];

/**
 * One notification, as the booking service writes it and as Dispatch and Completion send it to
 * `/internal/notifications`. It goes to a role (everyone holding it) or to one person.
 */
export type NotificationInput = {
  /** Same event, same key: a repeated delivery adds nothing. */
  dedupeKey: string;
  role?: NotifyRole;
  userId?: string;
  /** The person who caused it; it isn't shown to them. */
  actorId?: string | null;
  kind: string;
  title: string;
  message: string;
  /** Where the web app opens it; none for crew (they use the mobile app). */
  href?: string | null;
  bookingUuid?: string | null;
};

export const MAX_BATCH = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value: unknown, name: string, max: number, required = true): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new BadRequestException(`${name} is required`);
    return null;
  }
  if (typeof value !== 'string') throw new BadRequestException(`${name} must be text`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new BadRequestException(`${name} is required`);
  return trimmed.slice(0, max);
}

function uuid(value: unknown, name: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !UUID.test(value)) throw new BadRequestException(`${name} must be a UUID`);
  return value;
}

/** Checks one notification from another BMS service. */
export function parseNotificationInput(raw: unknown): NotificationInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('Each notification must be an object');
  const item = raw as Record<string, unknown>;
  const role = item.role === undefined || item.role === null ? null : String(item.role);
  if (role !== null && !(NOTIFY_ROLES as readonly string[]).includes(role)) throw new BadRequestException('Unknown notification role');
  const userId = uuid(item.userId, 'userId');
  if (!role && !userId) throw new BadRequestException('A notification needs a role or a user');
  const href = text(item.href, 'href', 300, false);
  // Links stay inside the web app
  if (href && (!href.startsWith('/') || href.startsWith('//'))) throw new BadRequestException('href must be a path in the web app');
  return {
    dedupeKey: text(item.dedupeKey, 'dedupeKey', 200)!,
    ...(role && { role: role as NotifyRole }),
    ...(userId && { userId }),
    actorId: uuid(item.actorId, 'actorId'),
    kind: text(item.kind, 'kind', 60)!,
    title: text(item.title, 'title', 200)!,
    message: text(item.message, 'message', 500)!,
    href,
    bookingUuid: uuid(item.bookingUuid, 'bookingUuid'),
  };
}
