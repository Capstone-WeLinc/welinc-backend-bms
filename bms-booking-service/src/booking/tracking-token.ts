import { createHmac, timingSafeEqual } from 'node:crypto';

function trackingSecret() {
  const secret = process.env.CUSTOMER_TRACKING_SECRET || process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('Customer tracking secret must contain at least 32 characters');
  return secret;
}

export function createTrackingToken(bookingId: string) {
  return createHmac('sha256', trackingSecret()).update(`customer-tracking:${bookingId}`).digest('hex');
}

export function verifyTrackingToken(bookingId: string, token: string) {
  if (!/^[a-f0-9]{64}$/i.test(token)) return false;
  const expected = Buffer.from(createTrackingToken(bookingId), 'hex');
  const provided = Buffer.from(token, 'hex');
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
