import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';

/** Crew leave requests join the Admin Approvals queue from the dispatch service (spec bms/0003). */

const crewItem = {
  id: 'c1', type: 'crew', subtype: 'emergency', bookingNo: 'DRV-001', client: 'Ramon Cruz (Driver)',
  summary: 'Emergency 2026-11-21: Sick', amount: null, submittedAt: '2026-11-21T01:00:00.000Z',
  submittedBy: 'ops-1', status: 'Requested',
};
const refundItem = {
  id: 'r1', type: 'refund', subtype: null, bookingNo: 'BK-1', client: 'Client', summary: 'Refund requested: x',
  amount: 100, submittedAt: '2026-11-20T01:00:00.000Z', submittedBy: 'cs-1', status: 'Requested',
};

function setup(dispatch: (url: string, init?: RequestInit) => { status: number; body: unknown } | 'down') {
  process.env.BMS_INTERNAL_SERVICE_KEY = 'k'.repeat(40);
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('/internal/completion/')) return new Response(JSON.stringify({ items: [refundItem] }), { status: 200 });
    const answer = dispatch(url, init);
    if (answer === 'down') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }) as typeof fetch;
  const prisma: any = { bookingChangeRequest: { findMany: async () => [] }, approvalOutbox: { findMany: async () => [] } };
  const directory: any = { lookup: async () => new Map() };
  return { service: new ApprovalsService(prisma, {} as any, directory), calls };
}

describe('Approvals – crew leave', () => {
  it('lists crew requests with the others, newest first, and counts them', async () => {
    const { service } = setup(() => ({ status: 200, body: { items: [crewItem] } }));
    const list = await service.list({ type: 'all' });
    expect(list.items.map((i) => i.id)).toEqual(['c1', 'r1']); // c1 was submitted after r1
    expect((await service.list({ type: 'crew' })).items.map((i) => i.id)).toEqual(['c1']);
    expect((await service.list({ search: 'ramon' })).items.map((i) => i.id)).toEqual(['c1']);
    const counts = await service.counts();
    expect(counts).toEqual(expect.objectContaining({ total: 2, crew: 1, emergency: 1, refund: 1, oldestAt: refundItem.submittedAt }));
  });

  it('still loads the other approvals when the dispatch service is down', async () => {
    const { service } = setup(() => 'down');
    expect((await service.list({ type: 'all' })).items.map((i) => i.id)).toEqual(['r1']);
  });

  it('only Admin can open a crew request', async () => {
    const { service } = setup(() => ({ status: 200, body: { ...crewItem, requestedBy: 'ops-1', audit: [] } }));
    await expect(service.detail('crew', 'c1', 'cs-1', false)).rejects.toThrow(ForbiddenException);
    await expect(service.detail('crew', 'c1', 'admin-1', true)).resolves.toEqual(expect.objectContaining({ id: 'c1', submittedByName: 'Unknown user' }));
  });

  it('passes the decision and the deciding Admin to dispatch', async () => {
    const { service, calls } = setup(() => ({ status: 200, body: { id: 'c1', status: 'Rejected' } }));
    await service.decide('crew', 'c1', 'admin-1', 'reject', 'No proof');
    const call = calls.find((c) => c.url.includes('/crew-leave/c1/reject'))!;
    expect(call.init?.method).toBe('POST');
    expect(JSON.parse(String(call.init?.body))).toEqual({ actor: 'admin-1', reason: 'No proof' });
  });

  it('shows dispatch refusals to Admin as conflicts', async () => {
    const { service } = setup(() => ({ status: 409, body: { message: 'This approval item has already been decided' } }));
    await expect(service.decide('crew', 'c1', 'admin-1', 'approve')).rejects.toThrow(new ConflictException('This approval item has already been decided'));
  });

  it('crew requests are not withdrawn or resubmitted through Approvals', async () => {
    const { service } = setup(() => ({ status: 200, body: {} }));
    await expect(service.withdraw('crew', 'c1', 'ops-1')).rejects.toThrow('Crew Leave page');
    await expect(service.resubmit('crew', 'c1', 'ops-1', {})).rejects.toThrow('new crew leave request');
  });
});
