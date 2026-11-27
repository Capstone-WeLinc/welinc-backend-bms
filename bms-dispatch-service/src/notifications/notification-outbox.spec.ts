import { NotificationOutbox, outboxDelayMs } from './notification-outbox';

/** Dispatch's notifications reach the booking service's bell, with retries (spec bms/0021). */

type Row = { id: string; payload: unknown; attempts: number };

function outbox(rows: Row[], answer: (items: unknown[]) => Response) {
  process.env.BMS_INTERNAL_SERVICE_KEY = 'k'.repeat(40);
  const posted: unknown[][] = [];
  global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
    const items = JSON.parse(String(init?.body)).items as unknown[];
    posted.push(items);
    return answer(items);
  }) as typeof fetch;
  const updates: Array<{ ids: string[]; data: Record<string, unknown> }> = [];
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue(rows),
    notificationOutbox: {
      updateMany: jest.fn(async ({ where, data }) => { updates.push({ ids: where.id.in, data }); return { count: where.id.in.length }; }),
      update: jest.fn(async ({ where, data }) => { updates.push({ ids: [where.id], data }); return data; }),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
  };
  return { service: new NotificationOutbox(prisma as never), posted, updates };
}

const rows = [{ id: 'a', payload: { dedupeKey: 'a' }, attempts: 0 }, { id: 'b', payload: { dedupeKey: 'b' }, attempts: 0 }];

describe('Notification outbox', () => {
  it('delivers a batch in one call and marks it delivered', async () => {
    const { service, posted, updates } = outbox(rows, () => new Response('{}', { status: 200 }));
    await service.flush();
    expect(posted).toEqual([[{ dedupeKey: 'a' }, { dedupeKey: 'b' }]]);
    expect(updates).toEqual([{ ids: ['a', 'b'], data: expect.objectContaining({ status: 'DELIVERED' }) }]);
  });

  it('keeps everything for a retry while Booking is down', async () => {
    const { service, updates } = outbox(rows, () => new Response('down', { status: 503 }));
    await service.flush();
    expect(updates.map((item) => [item.ids, item.data.status, item.data.attempts])).toEqual([[['a'], 'PENDING', 1], [['b'], 'PENDING', 1]]);
  });

  it('finds the one item Booking refuses and still delivers the rest', async () => {
    const { service, updates } = outbox(rows, (items) => new Response('{}', {
      status: items.some((item) => (item as { dedupeKey: string }).dedupeKey === 'b') ? 400 : 200,
    }));
    await service.flush();
    expect(updates.map((item) => [item.ids, item.data.status])).toEqual([[['a'], 'DELIVERED'], [['b'], 'FAILED']]);
  });

  it('waits longer after each failure, up to 10 minutes', () => {
    expect([1, 2, 3].map(outboxDelayMs)).toEqual([10_000, 20_000, 40_000]);
    expect(outboxDelayMs(30)).toBe(10 * 60_000);
  });
});
