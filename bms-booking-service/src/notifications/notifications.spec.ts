import { BadRequestException } from '@nestjs/common';
import { parseNotificationInput } from './notification-input';
import { KEEP_DAYS, NotificationsService, toRows, visibleTo } from './notifications.service';
import { changeDecidedNotices, newBookingNotices } from './booking-notices';

/** The bell's backend (spec bms/0021). */

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const BOOKING = { id: '33333333-3333-4333-8333-333333333333', bookingNo: 'BN-2026-0001', client: 'Ana Cruz', date: '2026-12-01', version: 1 };

describe('What other services may send', () => {
  const valid = { dedupeKey: 'joborder.ready:x', role: 'OPERATIONS', kind: 'joborder.ready', title: 'Job order ready', message: 'JO-1', href: '/operations/job-order' };

  it('accepts a role or a person, trims text and keeps the optional fields', () => {
    expect(parseNotificationInput(valid)).toEqual(expect.objectContaining({ role: 'OPERATIONS', href: '/operations/job-order', actorId: null, bookingUuid: null }));
    expect(parseNotificationInput({ ...valid, role: undefined, userId: ME, title: '  Hi  ' })).toEqual(expect.objectContaining({ userId: ME, title: 'Hi' }));
  });

  it('refuses one with no recipient, an unknown role, a bad id or a link out of the app', () => {
    for (const bad of [
      { ...valid, role: undefined },
      { ...valid, role: 'MECHANIC' },
      { ...valid, userId: 'not-a-uuid' },
      { ...valid, href: 'https://example.com' },
      { ...valid, href: '//example.com' },
      { ...valid, title: '' },
    ]) expect(() => parseNotificationInput(bad)).toThrow(BadRequestException);
  });
});

describe('Who sees a notification', () => {
  const where = visibleTo({ userId: ME, roles: ['CUSTOMER_SUPPORT'] }, new Date('2026-11-27T00:00:00Z'));

  it('is for my role or for me, within the keep window', () => {
    expect(where.OR).toEqual([{ recipientUserId: ME }, { recipientRole: { in: ['CUSTOMER_SUPPORT'] } }]);
    expect((where.createdAt as { gte: Date }).gte.toISOString()).toBe(new Date(Date.parse('2026-11-27T00:00:00Z') - KEEP_DAYS * 86_400_000).toISOString());
  });

  it('hides what I caused myself, but keeps notifications nobody caused', () => {
    expect(where.AND).toEqual([{ OR: [{ actorId: null }, { actorId: { not: ME } }] }]);
  });
});

describe('Reading notifications', () => {
  function service(rows: Array<Record<string, unknown>>) {
    const created: unknown[] = [];
    const prisma = {
      notification: {
        findFirst: jest.fn(async ({ where }) => rows.find((row) => row.id === where.id) ?? null),
        findMany: jest.fn(async () => rows),
      },
      notificationRead: { createMany: jest.fn(async ({ data }) => { created.push(...data); return { count: data.length }; }) },
    };
    return { notifications: new NotificationsService(prisma as never), created };
  }

  it('marks one as read for me only, and refuses one I can\'t see', async () => {
    const { notifications, created } = service([{ id: 'n1' }]);
    await notifications.markRead('n1', { userId: ME, roles: ['ADMIN'] });
    expect(created).toEqual([{ notificationId: 'n1', userId: ME }]);
    await expect(notifications.markRead('n2', { userId: ME, roles: ['ADMIN'] })).rejects.toThrow('Notification not found');
  });

  it('marks everything unread as read', async () => {
    const { notifications, created } = service([{ id: 'n1' }, { id: 'n2' }]);
    expect(await notifications.markAllRead({ userId: ME, roles: ['ADMIN'] })).toEqual({ read: 2 });
    expect(created).toHaveLength(2);
  });

  it('lists each notice with its booking, for the mobile app (spec bms/0023)', async () => {
    const base = { kind: 'crew.assigned', title: 'T', message: 'M', href: null, createdAt: new Date('2026-12-01T00:00:00Z'), reads: [] };
    const rows = [
      { ...base, id: 'n1', bookingUuid: BOOKING.id, booking: { bookingNo: BOOKING.bookingNo } },
      { ...base, id: 'n2', bookingUuid: null, booking: null, reads: [{ readAt: new Date() }] },
    ];
    const prisma = { notification: { findMany: jest.fn(async () => rows), count: jest.fn(async () => 1) } };
    const result = await new NotificationsService(prisma as never).list({ userId: ME, roles: ['DRIVER'] });
    expect(result.items).toEqual([
      expect.objectContaining({ id: 'n1', bookingUuid: BOOKING.id, bookingNo: 'BN-2026-0001', read: false }),
      expect.objectContaining({ id: 'n2', bookingUuid: null, bookingNo: null, read: true }),
    ]);
  });
});

describe('Booking notices', () => {
  it('tells Operations about every new booking, and Admin only about WeLinc ones', () => {
    expect(newBookingNotices(BOOKING, ME, false).map((item) => item.role)).toEqual(['OPERATIONS']);
    const welinc = newBookingNotices(BOOKING, null, true);
    expect(welinc.map((item) => [item.role, item.title])).toEqual([
      ['ADMIN', 'New booking received from WeLinc'], ['OPERATIONS', 'Booking needs team assignment'],
    ]);
    expect(toRows(welinc)[0]).toEqual(expect.objectContaining({ recipientRole: 'ADMIN', recipientUserId: null, bookingUuid: BOOKING.id }));
  });

  it('tells the requester about a decision, with the reason when rejected', () => {
    const [notice] = changeDecidedNotices({
      id: 'r1', type: 'reschedule', reason: null, requestedBy: OTHER, payloadAfter: {}, status: 'Rejected',
      decidedBy: ME, decidedAt: new Date(), decisionReason: 'No trucks that day',
    }, BOOKING);
    expect(notice).toEqual(expect.objectContaining({ userId: OTHER, actorId: ME, title: 'Your reschedule request was rejected', href: '/cs/my-submissions' }));
    expect(notice.message).toContain('No trucks that day');
  });
});
