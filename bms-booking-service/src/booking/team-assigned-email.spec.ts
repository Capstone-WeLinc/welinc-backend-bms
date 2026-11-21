import { assignedTeam } from './booking.service';
import { CustomerNotificationService } from './customer-notification.service';

/** The customer's "Team assigned" email names the truck and crew Operations assigned. */

const booking = {
  id: 'b1', bookingNo: 'BK-0147', client: 'Maria Santos', email: 'maria@example.com',
  date: '2026-11-22', service: 'Lipat Bahay', pickupAddress: 'Quezon City', deliveryAddress: 'Makati',
};

function mailer() {
  const service = new CustomerNotificationService();
  const sendMail = jest.fn().mockResolvedValue({});
  (service as unknown as { transporter: unknown }).transporter = { sendMail };
  return { service, sendMail };
}

describe('Team assigned email', () => {
  it('lists the truck, driver, helpers and dispatch time', async () => {
    const { service, sendMail } = mailer();
    await service.sendTrackingStatusUpdate(booking, 'Team assigned', {
      truck: 'NBC 1234 Truck 3', driverName: 'Ramon Dela Cruz', helperNames: ['Allan Domingo', 'Mark Anthony'], dispatchTime: '14:00',
    });
    const mail = sendMail.mock.calls[0][0];
    expect(mail.subject).toBe('Your truck and crew have been assigned (BK-0147)');
    for (const line of ['Truck: NBC 1234 Truck 3', 'Driver: Ramon Dela Cruz', 'Helpers: Allan Domingo, Mark Anthony', 'Dispatch time: 2:00 PM']) {
      expect(mail.text).toContain(line);
    }
    for (const value of ['NBC 1234 Truck 3', 'Ramon Dela Cruz', 'Allan Domingo, Mark Anthony', '2:00 PM']) {
      expect(mail.html).toContain(value);
    }
  });

  it('says "Helper" for one helper and still sends without a team', async () => {
    const { service, sendMail } = mailer();
    await service.sendTrackingStatusUpdate(booking, 'Team assigned', { driverName: 'Ramon Dela Cruz', helperNames: ['Allan Domingo'] });
    expect(sendMail.mock.calls[0][0].text).toContain('Helper: Allan Domingo');
    await service.sendTrackingStatusUpdate(booking, 'Team assigned');
    expect(sendMail.mock.calls[1][0].text).not.toContain('Driver:');
  });

  it('only adds the team to the "Team assigned" email', async () => {
    const { service, sendMail } = mailer();
    await service.sendTrackingStatusUpdate(booking, 'Delivered', { driverName: 'Ramon Dela Cruz', helperNames: [] });
    expect(sendMail.mock.calls[0][0].text).not.toContain('Driver:');
  });
});

describe('assignedTeam (what Booking accepts from Dispatch)', () => {
  it('keeps plain names, trims them, and drops anything else', () => {
    expect(assignedTeam({ truck: ' NBC 1234 ', driverName: 'Ramon', helperNames: ['Allan', '', 5, '  '], dispatchTime: '08:00', extra: 'x' }))
      .toEqual({ truck: 'NBC 1234', driverName: 'Ramon', helperNames: ['Allan'], dispatchTime: '08:00' });
    expect(assignedTeam({ driverName: 'x'.repeat(500), helperNames: [] })?.driverName).toHaveLength(120);
  });

  it('ignores missing or empty team details', () => {
    expect(assignedTeam(undefined)).toBeUndefined();
    expect(assignedTeam('Ramon')).toBeUndefined();
    expect(assignedTeam({ helperNames: [] })).toBeUndefined();
  });
});
