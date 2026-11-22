import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

type BookingNotice = {
  id: string;
  bookingNo: string;
  client: string;
  email: string | null;
  date: string;
  service?: string | null;
  preferredTime?: string | null;
  pickupAddress?: string | null;
  deliveryAddress?: string | null;
  address?: string | null;
};

type StatusTone = 'info' | 'success' | 'warning' | 'danger';

/** Everything one customer email says. Each email is complete on its own; nothing depends on a link. */
type EmailContent = {
  subject: string;
  preheader: string;
  headline: string;
  status: { label: string; tone: StatusTone };
  paragraphs: string[];
  /** Extra rows shown above the booking summary, e.g. the previous and new dates. */
  highlights?: { label: string; value: string }[];
  nextStep?: string;
};

const BRAND = { navy: '#1a1f6e', ink: '#0f172a', muted: '#64748b', border: '#e2e8f0', panel: '#f8fafc', gold: '#e8b800' };
const TONES: Record<StatusTone, { background: string; color: string; border: string }> = {
  info: { background: '#eef2ff', color: '#3730a3', border: '#c7d2fe' },
  success: { background: '#ecfdf5', color: '#047857', border: '#a7f3d0' },
  warning: { background: '#fffbeb', color: '#b45309', border: '#fde68a' },
  danger: { background: '#fef2f2', color: '#b91c1c', border: '#fecaca' },
};

/** What each delivery status means for the customer. */
const STATUS_UPDATES: Record<string, Omit<EmailContent, 'subject'> & { subjectLine: string }> = {
  'Team assigned': {
    subjectLine: 'Your truck and crew have been assigned',
    preheader: 'A truck and crew are now scheduled for your booking.',
    headline: 'Your truck and crew are assigned',
    status: { label: 'Team assigned', tone: 'info' },
    paragraphs: ['Good news: a truck and crew have been assigned to your booking. They will head to your pickup address on the scheduled date and time below.'],
    nextStep: 'Please make sure someone is available at the pickup address and that your items are ready to be loaded.',
  },
  'Pick-up in Progress': {
    subjectLine: 'Our crew is picking up your items',
    preheader: 'Our crew has arrived and is loading your items.',
    headline: 'Pick-up in progress',
    status: { label: 'Pick-up in progress', tone: 'info' },
    paragraphs: ['Our crew has arrived at the pickup address and is now loading your items.'],
    nextStep: 'We will let you know as soon as your items are on the way.',
  },
  'In Transit': {
    subjectLine: 'Your items are on the way',
    preheader: 'Your items have been loaded and are heading to the drop-off address.',
    headline: 'Your items are on the way',
    status: { label: 'In transit', tone: 'info' },
    paragraphs: ['Your items have been loaded and are now on the way to the drop-off address.'],
    nextStep: 'Please make sure someone is available at the drop-off address to receive them.',
  },
  Delivered: {
    subjectLine: 'Your items have been delivered',
    preheader: 'Your booking is complete. Thank you for choosing WeLinc Logistics.',
    headline: 'Delivered',
    status: { label: 'Delivered', tone: 'success' },
    paragraphs: ['Your items have been delivered to the drop-off address and your booking is now complete.', 'Thank you for choosing WeLinc Logistics. We hope to serve you again.'],
  },
};

@Injectable()
export class CustomerNotificationService {
  private readonly logger = new Logger(CustomerNotificationService.name);
  private readonly transporter: nodemailer.Transporter | null;
  private readonly from = process.env.SMTP_FROM || 'WeLinc Logistics <no-reply@welinc.com>';
  private readonly supportEmail = process.env.CUSTOMER_SUPPORT_EMAIL || '';
  private readonly supportPhone = process.env.CUSTOMER_SUPPORT_PHONE || '';

  constructor() {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    this.transporter = host && user && pass
      ? nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } })
      : null;
  }

  async sendBookingUpdate(booking: BookingNotice, change: 'rescheduled' | 'cancelled' | 'edited', previousDate?: string) {
    const content: EmailContent = change === 'cancelled'
      ? {
          subject: `Your booking has been cancelled (${booking.bookingNo})`,
          preheader: `Booking ${booking.bookingNo} has been cancelled.`,
          headline: 'Your booking has been cancelled',
          status: { label: 'Cancelled', tone: 'danger' },
          paragraphs: [`Your booking ${booking.bookingNo} has been cancelled, and no truck or crew will be sent for it.`],
          nextStep: 'If this was unexpected or you would like to book again, simply reply to this email and our team will help you.',
        }
      : change === 'rescheduled'
        ? {
            subject: `Your booking has been rescheduled (${booking.bookingNo})`,
            preheader: `Booking ${booking.bookingNo} has a new service date: ${this.formatDate(booking.date)}.`,
            headline: 'Your booking has been rescheduled',
            status: { label: 'Rescheduled', tone: 'warning' },
            paragraphs: ['Your booking has been moved to a new date. Please take note of the updated schedule below.'],
            highlights: [
              ...(previousDate ? [{ label: 'Previous date', value: this.formatDate(previousDate) }] : []),
              { label: 'New date', value: this.formatDate(booking.date) },
            ],
            nextStep: 'We will email you again once a truck and crew are assigned for the new date.',
          }
        : {
            subject: `Your booking details have been updated (${booking.bookingNo})`,
            preheader: `The details of booking ${booking.bookingNo} have been updated.`,
            headline: 'Your booking details have been updated',
            status: { label: 'Updated', tone: 'info' },
            paragraphs: ['We have updated the details of your booking. Here is the latest summary for your reference.'],
            nextStep: 'If anything below does not look right, simply reply to this email and we will correct it.',
          };
    await this.send(booking, content, `booking ${change}`);
  }

  /** Sent when a booking is first created: a confirmation with the booking summary. */
  async sendTrackingLink(booking: BookingNotice) {
    await this.send(booking, {
      subject: `We have received your booking (${booking.bookingNo})`,
      preheader: `Thank you for booking with WeLinc Logistics. Your booking number is ${booking.bookingNo}.`,
      headline: 'We have received your booking',
      status: { label: 'Booking received', tone: 'info' },
      paragraphs: ['Thank you for booking with WeLinc Logistics. Your booking has been received and our team is now arranging a truck and crew for you.'],
      nextStep: 'We will email you again once your truck and crew have been assigned. Please keep your booking number for reference.',
    }, 'booking confirmation');
  }

  async sendTrackingStatusUpdate(booking: BookingNotice, update: string) {
    const known = STATUS_UPDATES[update];
    const content: EmailContent = known
      ? { ...known, subject: `${known.subjectLine} (${booking.bookingNo})` }
      : {
          subject: `Update on your booking (${booking.bookingNo})`,
          preheader: `Booking ${booking.bookingNo} is now: ${update}.`,
          headline: 'An update on your booking',
          status: { label: update, tone: 'info' },
          paragraphs: [`Your booking is now: ${update}.`],
        };
    await this.send(booking, content, 'status update');
  }

  private async send(booking: BookingNotice, content: EmailContent, kind: string) {
    if (!booking.email) {
      this.logger.warn(`Booking ${booking.bookingNo} ${kind}; customer email is missing, so no notification was sent.`);
      return;
    }
    if (!this.transporter) {
      this.logger.warn(`Booking ${booking.bookingNo} ${kind}; SMTP is not configured, so no notification was sent.`);
      return;
    }
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: booking.email,
        // The sender is a no-reply address, so a customer's Reply goes to support instead of bouncing
        ...(this.supportEmail ? { replyTo: this.supportEmail } : {}),
        subject: content.subject,
        text: this.renderText(booking, content),
        html: this.renderHtml(booking, content),
      });
      this.logger.log(`Booking ${kind} email accepted by SMTP for ${booking.email}`);
    } catch (error) {
      this.logger.error(`Could not send booking ${kind} email for ${booking.bookingNo}`, error);
    }
  }

  /** The booking facts every email repeats, so the customer never has to look anything up. */
  private summaryRows(booking: BookingNotice) {
    const rows: { label: string; value: string }[] = [{ label: 'Booking number', value: booking.bookingNo }];
    if (booking.service) rows.push({ label: 'Service', value: booking.service });
    rows.push({ label: 'Service date', value: this.formatDate(booking.date) });
    if (booking.preferredTime) rows.push({ label: 'Preferred time', value: booking.preferredTime });
    const pickup = booking.pickupAddress || booking.address;
    if (pickup) rows.push({ label: 'Pickup address', value: pickup });
    if (booking.deliveryAddress) rows.push({ label: 'Drop-off address', value: booking.deliveryAddress });
    return rows;
  }

  private contactLine() {
    const ways = [this.supportPhone && `call us at ${this.supportPhone}`, this.supportEmail && `email ${this.supportEmail}`].filter(Boolean);
    return ways.length
      ? `Questions about your booking? Reply to this email or ${ways.join(' or ')}.`
      : 'Questions about your booking? Simply reply to this email and our team will get back to you.';
  }

  private renderText(booking: BookingNotice, content: EmailContent) {
    const line = (label: string, value: string) => `${label}: ${value}`;
    return [
      `Hello ${booking.client || 'Customer'},`,
      '',
      ...content.paragraphs.flatMap((paragraph) => [paragraph, '']),
      ...(content.highlights?.length ? [...content.highlights.map((row) => line(row.label, row.value)), ''] : []),
      'BOOKING SUMMARY',
      line('Status', content.status.label),
      ...this.summaryRows(booking).map((row) => line(row.label, row.value)),
      '',
      ...(content.nextStep ? [content.nextStep, ''] : []),
      this.contactLine(),
      '',
      'Thank you,',
      'WeLinc Logistics',
      '',
      'This is an automated message about your booking.',
    ].join('\n');
  }

  private renderHtml(booking: BookingNotice, content: EmailContent) {
    const e = (value: string) => this.escapeHtml(value);
    const tone = TONES[content.status.tone];
    const font = "font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;";
    const row = (label: string, value: string, strong = false) => `
      <tr>
        <td style="${font}padding:10px 16px;border-top:1px solid ${BRAND.border};color:${BRAND.muted};font-size:13px;width:38%;vertical-align:top;">${e(label)}</td>
        <td style="${font}padding:10px 16px;border-top:1px solid ${BRAND.border};color:${BRAND.ink};font-size:14px;vertical-align:top;${strong ? 'font-weight:bold;' : ''}">${e(value)}</td>
      </tr>`;
    const highlights = content.highlights?.length
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid ${tone.border};background:${tone.background};border-radius:8px;">
          ${content.highlights.map((item) => `<tr><td style="${font}padding:10px 16px;color:${tone.color};font-size:13px;width:38%;">${e(item.label)}</td><td style="${font}padding:10px 16px;color:${BRAND.ink};font-size:15px;font-weight:bold;">${e(item.value)}</td></tr>`).join('')}
        </table>`
      : '';
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(content.subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f4fa;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${e(content.preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f4fa;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid ${BRAND.border};border-radius:12px;overflow:hidden;">
        <tr><td style="${font}background:${BRAND.navy};padding:20px 28px;color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:0.3px;">WeLinc Logistics</td></tr>
        <tr><td style="background:${BRAND.gold};height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>
        <tr><td style="padding:28px;">
          <span style="${font}display:inline-block;padding:4px 12px;border:1px solid ${tone.border};background:${tone.background};color:${tone.color};border-radius:999px;font-size:11px;font-weight:bold;letter-spacing:0.6px;text-transform:uppercase;">${e(content.status.label)}</span>
          <h1 style="${font}margin:14px 0 18px;color:${BRAND.ink};font-size:22px;line-height:1.3;">${e(content.headline)}</h1>
          <p style="${font}margin:0 0 14px;color:${BRAND.ink};font-size:15px;line-height:1.6;">Hello ${e(booking.client || 'Customer')},</p>
          ${content.paragraphs.map((paragraph) => `<p style="${font}margin:0 0 14px;color:${BRAND.ink};font-size:15px;line-height:1.6;">${e(paragraph)}</p>`).join('')}
          <div style="height:6px;line-height:6px;font-size:0;">&nbsp;</div>
          ${highlights}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BRAND.border};border-radius:8px;border-collapse:separate;">
            <tr><td colspan="2" style="${font}padding:10px 16px;background:${BRAND.panel};color:${BRAND.navy};font-size:12px;font-weight:bold;letter-spacing:0.6px;text-transform:uppercase;border-radius:8px 8px 0 0;">Booking summary</td></tr>
            ${this.summaryRows(booking).map((item, index) => row(item.label, item.value, index === 0)).join('')}
          </table>
          ${content.nextStep ? `<p style="${font}margin:20px 0 0;padding:12px 16px;background:${BRAND.panel};border-left:3px solid ${BRAND.gold};color:${BRAND.ink};font-size:14px;line-height:1.6;">${e(content.nextStep)}</p>` : ''}
          <p style="${font}margin:20px 0 0;color:${BRAND.muted};font-size:14px;line-height:1.6;">${e(this.contactLine())}</p>
          <p style="${font}margin:20px 0 0;color:${BRAND.ink};font-size:15px;line-height:1.6;">Thank you,<br><strong>WeLinc Logistics</strong></p>
        </td></tr>
        <tr><td style="${font}padding:16px 28px;background:${BRAND.panel};border-top:1px solid ${BRAND.border};color:${BRAND.muted};font-size:12px;line-height:1.5;">This is an automated message about your booking ${e(booking.bookingNo)}. Please keep this email for your records.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  /** "2026-11-06" becomes "Friday, November 6, 2026"; anything else is shown as given. */
  private formatDate(value: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
    if (!match) return value || 'To be confirmed';
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  private escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
  }
}
