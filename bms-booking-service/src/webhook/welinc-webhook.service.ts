import { BadRequestException, ConflictException, Injectable, PayloadTooLargeException, ServiceUnavailableException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma.service';
import { CustomerNotificationService } from '../booking/customer-notification.service';
import { nextBookingNumber } from '../booking/booking-number';

const EVENT_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const EXTERNAL_ID = /^[A-Za-z0-9._:-]{1,100}$/;
type EventType = 'booking.created.v1' | 'booking.updated.v1' | 'booking.cancelled.v1';
type AdditionalService = { name: string; price: string };
type Snapshot = {
  customerName: string; service: string; date: string;
  amount?: string; serviceType?: string; deliveryCategory?: string;
  pickupAddress?: string; deliveryAddress?: string; contact?: string;
  email?: string; preferredTime?: string; notes?: string;
  itemDetails?: string; specialInstructions?: string; estimatedItems?: number;
  servicesAvailed?: string[]; protectiveMaterials?: string[];
  additionalServicesAvailed?: AdditionalService[];
  hasInsurance?: boolean; permitRequired?: boolean;
};
type Event = { eventType: EventType; externalBookingId: string; occurredAt: string; booking?: Snapshot };

function text(value: unknown, label: string, max: number, required = false): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (required) throw new UnprocessableEntityException(`Invalid ${label}`);
    return undefined;
  }
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new UnprocessableEntityException(`Invalid ${label}`);
  }
  return value.trim();
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function valueText(value: unknown, max = 2000): string | undefined {
  if (typeof value === 'string') return value.trim().slice(0, max) || undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value).slice(0, max);
  return undefined;
}

function money(value: unknown): string | undefined {
  const raw = valueText(value, 30)?.replace(/[₱,$\s]/g, '');
  if (!raw || !/^\d{1,8}(?:\.\d{1,2})?$/.test(raw)) return undefined;
  return Number(raw).toFixed(2);
}

function calendarParts(value: unknown): { date: string; time?: string } | undefined {
  const raw = valueText(value, 100);
  const match = raw?.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/);
  if (!match) return undefined;
  const parsed = new Date(`${match[1]}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== match[1]) return undefined;
  return { date: match[1], time: match[2] };
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (/^(yes|true|1)$/i.test(value.trim())) return true;
    if (/^(no|false|0)$/i.test(value.trim())) return false;
  }
  return undefined;
}

function wixFormFields(source: Record<string, unknown>) {
  return (Array.isArray(source.custom_form_fields) ? source.custom_form_fields : [])
    .map(record)
    .filter((field): field is Record<string, unknown> => Boolean(field))
    .map((field) => ({
      label: valueText(field.label, 200) ?? '',
      value: valueText(field.value, 2000),
    }))
    .filter((field) => field.label && field.value);
}

function wixAddOns(source: Record<string, unknown>) {
  const services: string[] = [];
  const protectiveMaterials: string[] = [];
  for (const item of (Array.isArray(source.add_on_groups) ? source.add_on_groups : []).map(record)) {
    if (!item) continue;
    const name = valueText(item.addon_group_name, 150) ?? 'Welinc add-on';
    const details = valueText(item.addon_group_details, 500);
    if (/protective|packing material/i.test(name)) protectiveMaterials.push(details ?? name);
    else services.push(details ? `${name}: ${details}` : name);
  }
  return { services: [...new Set(services)], protectiveMaterials: [...new Set(protectiveMaterials)] };
}

function optionalArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => valueText(item, 200)).filter((item): item is string => Boolean(item));
}

function constantTimeMatch(provided: string, expected: string): boolean {
  const bufA = Buffer.from(provided, 'utf8');
  const bufB = Buffer.from(expected, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function extractApiKey(request: Request): string | undefined {
  const q = request.query as Record<string, unknown> | undefined;
  const fromQuery = q?.apiKey ?? q?.key ?? q?.token ?? q?.api_key;
  if (typeof fromQuery === 'string' && fromQuery.trim()) return fromQuery.trim();
  const fromHeader = request.header('x-api-key') ?? request.header('x-welinc-api-key') ?? request.header('x-webhook-key');
  if (typeof fromHeader === 'string' && fromHeader.trim()) return fromHeader.trim();
  const auth = request.header('authorization');
  if (typeof auth === 'string') {
    const match = auth.match(/^(?:Bearer|ApiKey)\s+(.+)$/i);
    if (match) return match[1].trim();
  }
  return undefined;
}

export function parseEvent(raw: Buffer): Event {
  let input: Record<string, unknown>;
  try { input = JSON.parse(raw.toString('utf8')); }
  catch { throw new BadRequestException('Invalid JSON body'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new UnprocessableEntityException('Expected an event object');

  const isStrictContract =
    typeof input.eventType === 'string' &&
    ['booking.created.v1', 'booking.updated.v1', 'booking.cancelled.v1'].includes(input.eventType) &&
    typeof input.externalBookingId === 'string' &&
    EXTERNAL_ID.test(input.externalBookingId) &&
    typeof input.occurredAt === 'string';

  if (isStrictContract) {
    const eventType = input.eventType as EventType;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(input.occurredAt as string) ||
      !Number.isFinite(Date.parse(input.occurredAt as string))) {
      throw new UnprocessableEntityException('occurredAt must be a UTC timestamp');
    }
    let booking: Snapshot | undefined;
    if (eventType !== 'booking.cancelled.v1') {
      const source = input.booking;
      if (!source || typeof source !== 'object' || Array.isArray(source)) throw new UnprocessableEntityException('booking snapshot is required');
      const b = source as Record<string, unknown>;
      const date = text(b.date, 'booking.date', 10, true)!;
      const parsed = new Date(`${date}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        throw new UnprocessableEntityException('booking.date must be a calendar date');
      }
      booking = {
        customerName: text(b.customerName, 'booking.customerName', 200, true)!,
        service: text(b.service, 'booking.service', 100, true)!, date,
        amount: money(b.amount),
        serviceType: text(b.serviceType, 'booking.serviceType', 100),
        deliveryCategory: text(b.deliveryCategory, 'booking.deliveryCategory', 40),
        pickupAddress: text(b.pickupAddress, 'booking.pickupAddress', 1000),
        deliveryAddress: text(b.deliveryAddress, 'booking.deliveryAddress', 1000),
        contact: text(b.contact, 'booking.contact', 100),
        email: text(b.email, 'booking.email', 255),
        preferredTime: text(b.preferredTime, 'booking.preferredTime', 100),
        notes: text(b.notes, 'booking.notes', 2000),
        itemDetails: text(b.itemDetails, 'booking.itemDetails', 2000),
        specialInstructions: text(b.specialInstructions, 'booking.specialInstructions', 2000),
        estimatedItems: typeof b.estimatedItems === 'number' && Number.isInteger(b.estimatedItems) && b.estimatedItems >= 1
          ? b.estimatedItems
          : undefined,
        servicesAvailed: optionalArray(b.servicesAvailed),
        protectiveMaterials: optionalArray(b.protectiveMaterials),
        hasInsurance: booleanValue(b.hasInsurance),
        permitRequired: booleanValue(b.permitRequired),
      };
    }
    return { eventType, externalBookingId: input.externalBookingId as string, occurredAt: input.occurredAt as string, booking };
  }

  // Flexible / Wix Automations mapping
  const source = (input.data && typeof input.data === 'object' && !Array.isArray(input.data))
    ? (input.data as Record<string, unknown>)
    : input;

  const wixBooking = (source.booking && typeof source.booking === 'object' && !Array.isArray(source.booking))
    ? (source.booking as Record<string, unknown>)
    : undefined;

  const wixContact = (source.contact && typeof source.contact === 'object' && !Array.isArray(source.contact))
    ? (source.contact as Record<string, unknown>)
    : undefined;
  const wixContactName = record(wixContact?.name);
  const wixContactAddress = record(wixContact?.address);
  const customFields = wixFormFields(source);
  const customField = (pattern: RegExp) => customFields.find((field) => pattern.test(field.label))?.value;
  const customFieldSummary = customFields
    .filter((field) => !(/pick[\s_-]*up|origin/i.test(field.label) && /address|location/i.test(field.label)) &&
      !(/drop[\s_-]*off|delivery|destination/i.test(field.label) && /address|location/i.test(field.label)))
    .map((field) => `${field.label}: ${field.value}`)
    .join('\n');

  let eventType: EventType = 'booking.created.v1';
  const actionStr = String(source.action || source.status || wixBooking?.status || '').toLowerCase();
  if (source.eventType === 'booking.cancelled.v1' || actionStr.includes('cancel')) {
    eventType = 'booking.cancelled.v1';
  } else if (source.eventType === 'booking.updated.v1' || actionStr.includes('update') || actionStr.includes('resched')) {
    eventType = 'booking.updated.v1';
  }

  const rawExternalId = String(
    wixBooking?._id || wixBooking?.id || source.booking_id || source.bookingId ||
    source.externalBookingId || source.id || source.order_id || source.order_number || ''
  ).trim();
  if (!rawExternalId) throw new UnprocessableEntityException('A stable booking ID is required');
  const externalBookingId = rawExternalId.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 100);

  let occurredAt = String(source.occurredAt || source.updatedDate || source.booking_creation_date ||
    wixContact?.updatedDate || wixContact?.createdDate || wixBooking?.createdDate || wixBooking?.updatedDate || '').trim();
  if (!occurredAt || !Number.isFinite(Date.parse(occurredAt))) {
    occurredAt = new Date().toISOString();
  } else {
    occurredAt = new Date(occurredAt).toISOString();
  }

  let booking: Snapshot | undefined;
  if (eventType !== 'booking.cancelled.v1') {
    const formContact = (wixBooking?.formInfo && typeof wixBooking.formInfo === 'object')
      ? ((wixBooking.formInfo as Record<string, unknown>).contactDetails as Record<string, unknown> | undefined)
      : undefined;
    const directContact = (wixBooking?.contactDetails && typeof wixBooking.contactDetails === 'object')
      ? (wixBooking.contactDetails as Record<string, unknown>)
      : undefined;
    const firstName = String(formContact?.firstName || directContact?.firstName || source.booking_contact_first_name || wixContactName?.first || '').trim();
    const lastName = String(formContact?.lastName || directContact?.lastName || source.booking_contact_last_name || wixContactName?.last || '').trim();
    const combinedName = [firstName, lastName].filter(Boolean).join(' ');

    const customerName = (
      combinedName ||
      String(source.customerName || source.fullName || source.client || source.name || wixContactName?.formatted || wixBooking?.name || '').trim()
    ).slice(0, 200);
    if (!customerName) throw new UnprocessableEntityException('Booking customer name is required');

    const bookedEntity = (wixBooking?.bookedEntity && typeof wixBooking.bookedEntity === 'object')
      ? (wixBooking.bookedEntity as Record<string, unknown>)
      : undefined;
    const service = String(bookedEntity?.title || bookedEntity?.name || wixBooking?.serviceTitle ||
      source.service || source.serviceName || source.service_name || source.service_name_main_language || '').trim().slice(0, 100);
    if (!service) throw new UnprocessableEntityException('Booking service is required');

    const starts = [wixBooking?.startDate, source.start_date_by_business_tz, source.start_date, source.startDate, source.date]
      .map(calendarParts);
    const start = starts.find((value): value is { date: string; time?: string } => Boolean(value));
    if (!start) throw new UnprocessableEntityException('Booking start date is required and must be a valid date');
    const dateStr = start.date;
    const preferredTime = valueText(source.preferredTime, 100) || starts.find((value) => value?.time)?.time;

    const primaryInfo = record(wixContact?.primaryInfo);
    const phone = String(formContact?.phone || directContact?.phone || source.booking_contact_phone || primaryInfo?.phone || wixContact?.phone || source.contact || source.phone || '').trim();
    const contact = phone ? phone.slice(0, 100) : undefined;

    const emailStr = String(formContact?.email || directContact?.email || source.booking_contact_email || primaryInfo?.email || wixContact?.email || source.email || '').trim();
    const email = emailStr ? emailStr.slice(0, 255) : undefined;

    const formAddr = formContact?.address && typeof formContact.address === 'object'
      ? (formContact.address as Record<string, unknown>).formatted
      : undefined;
    const contactAddr = wixContactAddress?.formatted || wixContactAddress?.addressLine;
    const addr = String(customField(/(?:pick[\s_-]*up|origin).*(?:address|location)|(?:address|location).*(?:pick[\s_-]*up|origin)/i) ||
      formAddr || source.pickupAddress || source.address || source.location || contactAddr || '').trim();
    const pickupAddress = addr ? addr.slice(0, 1000) : undefined;
    const deliv = String(customField(/(?:drop[\s_-]*off|delivery|destination).*(?:address|location)|(?:address|location).*(?:drop[\s_-]*off|delivery|destination)/i) ||
      source.deliveryAddress || '').trim();
    const deliveryAddress = deliv ? deliv.slice(0, 1000) : undefined;

    const instructionAnswer = customField(/instruction|note|preferred time|preferred date/i);
    const notesStr = String(wixBooking?.notes || source.notes || customFieldSummary || instructionAnswer || '').trim();
    const notes = notesStr ? notesStr.slice(0, 2000) : undefined;
    const instructionText = String(source.specialInstructions || instructionAnswer || customFieldSummary || '').trim();
    const specialInstructions = instructionText ? instructionText.slice(0, 2000) : undefined;
    const addOns = wixAddOns(source);
    const price = record(source.price);
    const priceCurrency = valueText(price?.currency || source.currency, 10);
    const amount = (!priceCurrency || priceCurrency.toUpperCase() === 'PHP')
      ? money(price?.value) || money(source.amount_due) || money(source.amount)
      : undefined;
    const itemDetails = valueText(source.itemDetails || source.item_details || customField(/item details|items|contents|goods/i), 2000);
    const estimatedItemsRaw = source.estimatedItems ?? source.estimated_items ?? customField(/estimated (number of )?items|item count/i);
    const estimatedItemsValue = Number(estimatedItemsRaw);
    const estimatedItems = Number.isInteger(estimatedItemsValue) && estimatedItemsValue >= 1 && estimatedItemsValue <= 10000
      ? estimatedItemsValue
      : undefined;
    const permitRequired = booleanValue(source.permitRequired ?? source.permit_required ?? customField(/permit required/i));
    const hasInsurance = booleanValue(source.hasInsurance ?? source.has_insurance ?? customField(/insurance/i));
    const resource = valueText(source.staff_member_name_main_language || source.staff_member_name, 200);

    booking = {
      customerName,
      service,
      date: dateStr,
      amount,
      serviceType: valueText(source.serviceType || source.service_type, 100),
      deliveryCategory: valueText(source.deliveryCategory || source.delivery_category, 40),
      pickupAddress,
      deliveryAddress,
      contact,
      email,
      preferredTime,
      notes: [notes, resource ? `Welinc service resource: ${resource}` : undefined].filter(Boolean).join('\n').slice(0, 2000) || undefined,
      itemDetails,
      specialInstructions: specialInstructions || notes,
      estimatedItems,
      servicesAvailed: [...addOns.services, ...(optionalArray(source.servicesAvailed) ?? [])],
      protectiveMaterials: [...addOns.protectiveMaterials, ...(optionalArray(source.protectiveMaterials) ?? [])],
      additionalServicesAvailed: Array.isArray(source.additionalServicesAvailed)
        ? source.additionalServicesAvailed.map(record).filter((item): item is Record<string, unknown> => Boolean(item))
          .map((item) => ({ name: valueText(item.name, 150) ?? '', price: valueText(item.price, 100) ?? '' }))
          .filter((item) => item.name)
        : undefined,
      hasInsurance,
      permitRequired,
    };
  }

  return { eventType, externalBookingId, occurredAt, booking };
}

@Injectable()
export class WelincWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerNotifications: CustomerNotificationService,
  ) {}

  async receive(request: RawBodyRequest<Request>) {
    const apiKeyEnv = process.env.BMS_WELINC_WEBHOOK_API_KEY;
    const secretEnv = process.env.BMS_WELINC_BOOKING_WEBHOOK_SECRET;
    if ((!apiKeyEnv || apiKeyEnv.length < 8) && (!secretEnv || secretEnv.length < 32)) {
      throw new ServiceUnavailableException('Webhook receiver is not configured');
    }
    const raw = request.rawBody ?? (request.body ? Buffer.from(JSON.stringify(request.body)) : undefined);
    if (!raw) throw new BadRequestException('Missing request body');
    if (raw.length > 64 * 1024) throw new PayloadTooLargeException();

    const providedApiKey = extractApiKey(request);
    let authenticated = false;
    if (providedApiKey) {
      if ((apiKeyEnv && constantTimeMatch(providedApiKey, apiKeyEnv)) ||
          (secretEnv && constantTimeMatch(providedApiKey, secretEnv))) {
        authenticated = true;
      } else {
        throw new UnauthorizedException('Invalid webhook API key');
      }
    }

    if (!authenticated) {
      const secret = secretEnv || apiKeyEnv;
      if (!secret || secret.length < 32) throw new UnauthorizedException('Invalid webhook authentication');
      const eventIdHeader = request.header('x-welinc-event-id') ?? '';
      const timestamp = request.header('x-welinc-timestamp') ?? '';
      const signature = request.header('x-welinc-signature') ?? '';
      if (!EVENT_ID.test(eventIdHeader) || !/^\d{10}$/.test(timestamp) ||
        Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !/^sha256=[0-9a-f]{64}$/i.test(signature)) {
        throw new UnauthorizedException('Invalid webhook authentication');
      }
      const expected = createHmac('sha256', secret).update(timestamp).update('.').update(raw).digest();
      if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) {
        throw new UnauthorizedException('Invalid webhook authentication');
      }
      authenticated = true;
    }

    const event = parseEvent(raw);
    const hash = createHash('sha256').update(raw).digest('hex');
    const occurredAt = new Date(event.occurredAt);

    let eventId = request.header('x-welinc-event-id') || request.header('x-event-id');
    if (!eventId || !EVENT_ID.test(eventId)) {
      const safeId = event.externalBookingId.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 40);
      eventId = `wix-${safeId}-${hash.slice(0, 16)}`;
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${event.externalBookingId}))::text`;
        const previous = await tx.welincWebhookEvent.findUnique({ where: { eventId } });
        if (previous) {
          if (previous.payloadSha256 !== hash) throw new ConflictException('Event ID was reused with different content');
          return { accepted: true, duplicate: true, applied: previous.result === 'APPLIED', pendingReview: previous.result === 'BLOCKED' && !previous.reviewedAt };
        }
        const record = (result: string, reason?: string) => tx.welincWebhookEvent.create({ data: {
          eventId, eventType: event.eventType, externalBookingId: event.externalBookingId,
          payloadSha256: hash, payload: event as unknown as Prisma.InputJsonValue,
          occurredAt, result, reason,
        } });
        const link = await tx.welincBookingLink.findUnique({ where: { externalBookingId: event.externalBookingId } });
        if (event.eventType === 'booking.created.v1') {
          const deleted = await tx.welincWebhookEvent.findFirst({
            where: { externalBookingId: event.externalBookingId, result: 'DELETED' },
            select: { eventId: true },
          });
          if (deleted) return { accepted: true, duplicate: true, applied: false, pendingReview: false };
          if (link) {
            await record('IGNORED', 'already_imported');
            return { accepted: true, duplicate: true, applied: false, pendingReview: false };
          }
          const b = event.booking!;
          const now = new Date();
          const bookingNo = await nextBookingNumber(tx, now);
          const booking = await tx.booking.create({ data: {
            bookingId: `WL-${randomUUID()}`,
            bookingNo,
            client: b.customerName, fullName: b.customerName, service: b.service, date: b.date,
            amount: b.amount, totalAmount: b.amount,
            serviceType: b.serviceType, deliveryCategory: b.deliveryCategory,
            pickupAddress: b.pickupAddress, deliveryAddress: b.deliveryAddress,
            address: b.deliveryAddress ?? b.pickupAddress, contact: b.contact, email: b.email,
            preferredTime: b.preferredTime, notes: b.notes,
            itemDetails: b.itemDetails, specialInstructions: b.specialInstructions,
            estimatedItems: b.estimatedItems,
            servicesAvailed: b.servicesAvailed ?? [], protectiveMaterials: b.protectiveMaterials ?? [],
            ...(b.additionalServicesAvailed && { additionalServicesAvailed: b.additionalServicesAvailed as Prisma.InputJsonValue }),
            hasInsurance: b.hasInsurance ?? false, permitRequired: b.permitRequired ?? false,
          } });
          await tx.welincBookingLink.create({ data: {
            externalBookingId: event.externalBookingId, bookingUuid: booking.id, lastOccurredAt: occurredAt,
          } });
          await record('APPLIED');
          return { accepted: true, duplicate: false, applied: true, pendingReview: false, bookingId: booking.id };
        }
        if (!link) throw new ConflictException('Booking creation has not arrived; retry this event');
        if (occurredAt <= link.lastOccurredAt) {
          await record('STALE');
          return { accepted: true, duplicate: false, applied: false, pendingReview: false };
        }
        const booking = await tx.booking.findUnique({ where: { id: link.bookingUuid } });
        if (!booking) throw new ConflictException('Imported booking is missing in BMS');
        const b = event.booking;
        const material = event.eventType === 'booking.updated.v1' && Boolean(b && (
          booking.date !== b.date || booking.service !== b.service ||
          booking.pickupAddress !== (b.pickupAddress ?? null) ||
          booking.deliveryAddress !== (b.deliveryAddress ?? null)
        ));
        if (booking.status === 'Completed' || booking.status === 'Cancelled' ||
          ((material || event.eventType === 'booking.cancelled.v1') && (booking.operationalHold || booking.paymentHold))) {
          await record('BLOCKED', 'booking_final_dispatched_or_paid');
          return { accepted: true, duplicate: false, applied: false, pendingReview: true };
        }
        if (event.eventType === 'booking.cancelled.v1') {
          await tx.booking.update({ where: { id: booking.id }, data: { status: 'Cancelled', version: { increment: 1 } } });
        } else {
          const snapshot = b!;
          await tx.booking.update({ where: { id: booking.id }, data: {
            client: snapshot.customerName, fullName: snapshot.customerName,
            service: snapshot.service, date: snapshot.date,
            ...(snapshot.amount !== undefined && { amount: snapshot.amount, totalAmount: snapshot.amount }),
            ...(snapshot.serviceType !== undefined && { serviceType: snapshot.serviceType }),
            ...(snapshot.deliveryCategory !== undefined && { deliveryCategory: snapshot.deliveryCategory }),
            pickupAddress: snapshot.pickupAddress ?? null,
            deliveryAddress: snapshot.deliveryAddress ?? null,
            address: snapshot.deliveryAddress ?? snapshot.pickupAddress ?? null,
            contact: snapshot.contact ?? null, email: snapshot.email ?? null,
            preferredTime: snapshot.preferredTime ?? null, notes: snapshot.notes ?? null,
            ...(snapshot.itemDetails !== undefined && { itemDetails: snapshot.itemDetails }),
            ...(snapshot.specialInstructions !== undefined && { specialInstructions: snapshot.specialInstructions }),
            ...(snapshot.estimatedItems !== undefined && { estimatedItems: snapshot.estimatedItems }),
            ...(snapshot.servicesAvailed !== undefined && { servicesAvailed: snapshot.servicesAvailed }),
            ...(snapshot.protectiveMaterials !== undefined && { protectiveMaterials: snapshot.protectiveMaterials }),
            ...(snapshot.additionalServicesAvailed && { additionalServicesAvailed: snapshot.additionalServicesAvailed as Prisma.InputJsonValue }),
            ...(snapshot.hasInsurance !== undefined && { hasInsurance: snapshot.hasInsurance }),
            ...(snapshot.permitRequired !== undefined && { permitRequired: snapshot.permitRequired }),
            ...(material && { status: 'Rescheduled' }), version: { increment: 1 },
          } });
        }
        await tx.welincBookingLink.update({ where: { externalBookingId: event.externalBookingId }, data: { lastOccurredAt: occurredAt } });
        await record('APPLIED');
        return { accepted: true, duplicate: false, applied: true, pendingReview: false, bookingId: booking.id };
      });
      if (result.applied && !result.duplicate && 'bookingId' in result && typeof result.bookingId === 'string') {
        const booking = await this.prisma.booking.findUnique({ where: { id: result.bookingId } });
        if (booking && event.eventType === 'booking.cancelled.v1') await this.customerNotifications.sendBookingUpdate(booking, 'cancelled');
        else if (booking && event.eventType === 'booking.updated.v1') await this.customerNotifications.sendBookingUpdate(booking, booking.status === 'Rescheduled' ? 'rescheduled' : 'edited');
      }
      return result;
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      const previous = await this.prisma.welincWebhookEvent.findUnique({ where: { eventId } });
      if (previous?.payloadSha256 === hash) {
        return { accepted: true, duplicate: true, applied: previous.result === 'APPLIED', pendingReview: previous.result === 'BLOCKED' && !previous.reviewedAt };
      }
      throw new ConflictException('Event or booking ID already exists with different content');
    }
  }

  async pendingReview() {
    const events = await this.prisma.welincWebhookEvent.findMany({
      where: { result: 'BLOCKED', reviewedAt: null }, orderBy: { receivedAt: 'desc' }, take: 100,
    });
    const links = await this.prisma.welincBookingLink.findMany({
      where: { externalBookingId: { in: events.map((event) => event.externalBookingId) } },
      select: { externalBookingId: true, bookingUuid: true },
    });
    const byExternalId = new Map(links.map((link) => [link.externalBookingId, link.bookingUuid]));
    return events.map((event) => ({ ...event, bookingUuid: byExternalId.get(event.externalBookingId) ?? null }));
  }

  async importedBookingNotifications() {
    const events = await this.prisma.welincWebhookEvent.findMany({
      where: { eventType: 'booking.created.v1', result: 'APPLIED' },
      orderBy: { receivedAt: 'desc' },
      take: 100,
      select: { eventId: true, externalBookingId: true, receivedAt: true },
    });
    const deletedEvents = await this.prisma.welincWebhookEvent.findMany({
      where: { eventType: 'booking.created.v1', result: 'DELETED' },
      select: { eventId: true },
    });
    if (!events.length) return deletedEvents.map((event) => ({ id: event.eventId, deleted: true }));
    const links = await this.prisma.welincBookingLink.findMany({
      where: { externalBookingId: { in: events.map((event) => event.externalBookingId) } },
      select: {
        externalBookingId: true,
        booking: { select: { id: true, bookingNo: true, client: true } },
      },
    });
    const byExternalId = new Map(links.map((link) => [link.externalBookingId, link.booking]));
    const imported = events.flatMap((event) => {
      const booking = byExternalId.get(event.externalBookingId);
      return booking ? [{
        id: event.eventId,
        externalBookingId: event.externalBookingId,
        bookingId: booking.id,
        bookingNo: booking.bookingNo,
        client: booking.client,
        receivedAt: event.receivedAt,
      }] : [];
    });
    return [...imported, ...deletedEvents.map((event) => ({ id: event.eventId, deleted: true }))];
  }

  async deletedBookingNotificationRefs() {
    const events = await this.prisma.welincWebhookEvent.findMany({
      where: { eventType: 'booking.created.v1', result: 'DELETED' },
      select: { payload: true },
    });
    const bookingNos = new Set<string>();
    for (const event of events) {
      const payload = event.payload as { deletedBookingNos?: unknown } | null;
      if (!Array.isArray(payload?.deletedBookingNos)) continue;
      for (const value of payload.deletedBookingNos) {
        if (typeof value === 'string' && /^BN-[A-Za-z0-9-]{1,50}$/.test(value)) bookingNos.add(value);
      }
    }
    return { bookingNos: [...bookingNos] };
  }

  async review(eventId: string, action: unknown, noteInput: unknown, actorId: string) {
    if (!EVENT_ID.test(eventId) || !['apply', 'dismiss'].includes(String(action))) {
      throw new BadRequestException('Invalid review request');
    }
    const note = String(noteInput ?? '').trim();
    if (!note || note.length > 500) throw new BadRequestException('Review note is required');
    return this.prisma.$transaction(async (tx) => {
      const stored = await tx.welincWebhookEvent.findUnique({ where: { eventId } });
      if (!stored || stored.result !== 'BLOCKED' || stored.reviewedAt) throw new ConflictException('Event is not pending review');
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${stored.externalBookingId}))::text`;
      const event = stored.payload as Event;
      const link = await tx.welincBookingLink.findUnique({ where: { externalBookingId: stored.externalBookingId } });
      if (!link) throw new ConflictException('Imported booking link is missing');
      if (action === 'dismiss') {
        return tx.welincWebhookEvent.update({ where: { eventId }, data: {
          reviewedAt: new Date(), reviewedBy: actorId, reviewResolution: 'DISMISSED', reviewNote: note,
        } });
      }
      if (stored.occurredAt <= link.lastOccurredAt) throw new ConflictException('A newer Welinc event already applied');
      const booking = await tx.booking.findUnique({ where: { id: link.bookingUuid } });
      if (!booking || booking.status === 'Completed' || booking.status === 'Cancelled' ||
        booking.operationalHold || booking.paymentHold) {
        throw new ConflictException('Booking work or payment still blocks this event');
      }
      if (event.eventType === 'booking.cancelled.v1') {
        await tx.booking.update({ where: { id: booking.id }, data: { status: 'Cancelled', version: { increment: 1 } } });
      } else if (event.eventType === 'booking.updated.v1' && event.booking) {
        const b = event.booking;
        await tx.booking.update({ where: { id: booking.id }, data: {
          client: b.customerName, fullName: b.customerName, service: b.service, date: b.date,
          pickupAddress: b.pickupAddress ?? null, deliveryAddress: b.deliveryAddress ?? null,
          address: b.deliveryAddress ?? b.pickupAddress ?? null, contact: b.contact ?? null,
          email: b.email ?? null, preferredTime: b.preferredTime ?? null, notes: b.notes ?? null,
          status: 'Rescheduled', version: { increment: 1 },
        } });
      } else throw new ConflictException('Only edited or cancelled events can be reviewed');
      await tx.welincBookingLink.update({ where: { externalBookingId: stored.externalBookingId }, data: { lastOccurredAt: stored.occurredAt } });
      return tx.welincWebhookEvent.update({ where: { eventId }, data: {
        result: 'APPLIED', reviewedAt: new Date(), reviewedBy: actorId, reviewResolution: 'APPLIED', reviewNote: note,
      } });
    });
  }
}
