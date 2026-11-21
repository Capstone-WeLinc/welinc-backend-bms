import { ApprovalsService } from './approvals.service';

/** The Admin Approvals "History" tab and the "Overdue" card. */

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString();

const verifiedCollection = { id: 'col', type: 'collection', subtype: null, bookingNo: 'BK-1', client: 'Ana', summary: 'GCash collection', amount: 500,
  submittedAt: '2026-11-18T02:00:00.000Z', submittedBy: 'cs-1', status: 'Verified', decidedBy: 'admin-1', decidedAt: '2026-11-19T02:00:00.000Z' };
const rejectedRefund = { id: 'ref', type: 'refund', subtype: null, bookingNo: 'BK-2', client: 'Ben', summary: 'Refund: damaged', amount: 100,
  submittedAt: '2026-11-19T02:00:00.000Z', submittedBy: 'cs-1', status: 'Rejected', decisionReason: 'No photo', decidedBy: 'admin-2', decidedAt: '2026-11-21T02:00:00.000Z' };
const withdrawnLeave = { id: 'crew', type: 'crew', subtype: 'leave', bookingNo: 'DRV-001', client: 'Ramon (Driver)', summary: 'Leave 2026-11-25', amount: null,
  submittedAt: '2026-11-20T02:00:00.000Z', submittedBy: 'ops-1', status: 'Withdrawn', decidedBy: 'ops-1', decidedAt: '2026-11-20T05:00:00.000Z' };

function setup(pending: unknown[] = []) {
  process.env.BMS_INTERNAL_SERVICE_KEY = 'k'.repeat(40);
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('/internal/completion/approvals?status=history') ? { items: [verifiedCollection, rejectedRefund] }
      : url.includes('/internal/dispatch/crew-leave?status=history') ? { items: [withdrawnLeave] }
        : url.includes('/internal/completion/approvals') ? { items: pending }
          : { items: [] };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  const prisma: any = { bookingChangeRequest: { findMany: async () => [] } };
  const names: Record<string, string> = { 'admin-1': 'Bernardo Mendoza', 'admin-2': 'Evangeline Cortez', 'ops-1': 'Oscar Santos', 'cs-1': 'Clara Reyes' };
  const directory: any = { lookup: async (ids: string[]) => new Map(ids.filter((id) => names[id]).map((id) => [id, { name: names[id], roles: [] }])) };
  return new ApprovalsService(prisma, {} as any, directory);
}

describe('Approvals history', () => {
  it('lists every decided request, newest decision first, with who decided', async () => {
    const result = await setup().list({ status: 'history' });
    expect(result.items.map((i) => i.id)).toEqual(['ref', 'crew', 'col']);
    expect(result.items.map((i) => (i as { decidedByName?: string }).decidedByName)).toEqual(['Evangeline Cortez', 'Oscar Santos', 'Bernardo Mendoza']);
  });

  it('filters by decision, treating Verified and Refunded as Approved', async () => {
    const service = setup();
    expect((await service.list({ status: 'history', decision: 'approved' })).items.map((i) => i.id)).toEqual(['col']);
    expect((await service.list({ status: 'history', decision: 'rejected' })).items.map((i) => i.id)).toEqual(['ref']);
    expect((await service.list({ status: 'history', decision: 'withdrawn' })).items.map((i) => i.id)).toEqual(['crew']);
  });

  it('filters by type and by the date it was decided', async () => {
    const service = setup();
    expect((await service.list({ status: 'history', type: 'refund' })).items.map((i) => i.id)).toEqual(['ref']);
    expect((await service.list({ status: 'history', from: '2026-11-20', to: '2026-11-20' })).items.map((i) => i.id)).toEqual(['crew']);
  });
});

describe('Overdue card', () => {
  it('shows only requests waiting more than 24 hours', async () => {
    const pending = [
      { id: 'old', type: 'collection', subtype: null, bookingNo: 'BK-3', client: 'C', summary: 'x', amount: 1, submittedAt: hoursAgo(30), submittedBy: 'cs-1', status: 'PENDING' },
      { id: 'new', type: 'collection', subtype: null, bookingNo: 'BK-4', client: 'D', summary: 'y', amount: 1, submittedAt: hoursAgo(2), submittedBy: 'cs-1', status: 'PENDING' },
    ];
    const service = setup(pending);
    expect((await service.list({ overdue: 'true' })).items.map((i) => i.id)).toEqual(['old']);
    expect((await service.counts()).overdue).toBe(1);
  });
});
