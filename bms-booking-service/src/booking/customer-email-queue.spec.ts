import { CustomerNotificationService, EMAIL_MAX_ATTEMPTS, retryDelayMs } from './customer-notification.service';

/** Customer emails are queued and retried (spec bms/0021). */

function queue(email: Record<string, unknown>, sendMail: jest.Mock | null) {
  const updates: Array<Record<string, unknown>> = [];
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'e1' }]),
    customerEmail: {
      findUnique: jest.fn(async () => email),
      update: jest.fn(async ({ data }) => { updates.push(data); return data; }),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
  };
  const service = new CustomerNotificationService(prisma as never);
  (service as unknown as { transporter: unknown }).transporter = sendMail ? { sendMail } : null;
  return { service, updates };
}

const pending = { id: 'e1', status: 'PENDING', attempts: 0, bookingNo: 'BK-1', kind: 'booking confirmation', recipient: 'ana@example.com', subject: 'S', textBody: 'T', htmlBody: 'H' };

describe('Customer email queue', () => {
  it('sends a queued email and marks it sent', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    const { service, updates } = queue(pending, sendMail);
    await service.flush();
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'ana@example.com', subject: 'S', text: 'T', html: 'H' }));
    expect(updates[0]).toEqual(expect.objectContaining({ status: 'SENT', lockedUntil: null }));
  });

  it('keeps a failed email for another try later', async () => {
    const { service, updates } = queue(pending, jest.fn().mockRejectedValue(new Error('SMTP down')));
    await service.flush();
    expect(updates[0]).toEqual(expect.objectContaining({ status: 'PENDING', attempts: 1, lastError: 'SMTP down' }));
    expect((updates[0].nextAttemptAt as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it('gives up after the last attempt', async () => {
    const { service, updates } = queue({ ...pending, attempts: EMAIL_MAX_ATTEMPTS - 1 }, jest.fn().mockRejectedValue(new Error('SMTP down')));
    await service.flush();
    expect(updates[0]).toEqual(expect.objectContaining({ status: 'FAILED', attempts: EMAIL_MAX_ATTEMPTS }));
  });

  it('marks emails skipped when SMTP isn\'t set up, so they don\'t pile up', async () => {
    const { service, updates } = queue(pending, null);
    await service.flush();
    expect(updates[0]).toEqual(expect.objectContaining({ status: 'SKIPPED' }));
  });

  it('waits longer after each failure, up to an hour', () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([60_000, 120_000, 240_000, 480_000]);
    expect(retryDelayMs(20)).toBe(60 * 60_000);
  });
});
