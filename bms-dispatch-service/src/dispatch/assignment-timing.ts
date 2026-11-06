/** Loading, unloading and a safety buffer allowed for every booking, on top of driving. */
export const ON_SITE_MINUTES = 120;

export type TimedBooking = {
  bookingNo: string;
  pickupTime: string | null;
  pickupAddress: string | null;
  deliveryAddress: string | null;
};

export type TimingStatus = 'available' | 'blocked' | 'unverified';
export type TimingResult = { status: TimingStatus; message?: string };

/** Driving minutes between two addresses, or null when they can't be worked out. */
export type TravelLookup = (from: string, to: string) => Promise<number | null>;

// Bookings store pickup times as either "14:00" or "2:00 PM".
export function parseTimeMinutes(value?: string | null) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i.exec(value?.trim() ?? '');
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = match[3]?.toUpperCase();
  if (minute > 59 || (period ? hour < 1 || hour > 12 : hour > 23)) return null;
  return ((period ? (hour % 12) + (period === 'PM' ? 12 : 0) : hour) * 60) + minute;
}

export function formatMinutes(total: number) {
  const hour = Math.floor(total / 60) % 24;
  return `${hour % 12 || 12}:${String(total % 60).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}

/**
 * Can the same truck or crew serve both bookings on one day? The earlier job must finish
 * and the truck must reach the later pickup in time:
 * earlier pickup + drive between its stops + on-site time + drive to the later pickup <= later pickup.
 */
export async function checkBookingTiming(target: TimedBooking, other: TimedBooking, travel: TravelLookup): Promise<TimingResult> {
  const targetStart = parseTimeMinutes(target.pickupTime);
  const otherStart = parseTimeMinutes(other.pickupTime);
  if (targetStart === null || otherStart === null) {
    return { status: 'unverified', message: `Pickup time is missing, so timing against ${other.bookingNo} couldn't be checked.` };
  }

  const targetIsLater = targetStart >= otherStart;
  const earlier = targetIsLater ? other : target;
  const later = targetIsLater ? target : other;
  const earlierStart = Math.min(targetStart, otherStart);
  const laterStart = Math.max(targetStart, otherStart);
  const busyMessage = `Busy with ${other.bookingNo} (pickup ${formatMinutes(otherStart)}).`;

  // Too close to need a route lookup: the on-site time alone doesn't fit.
  if (laterStart - earlierStart < ON_SITE_MINUTES) return { status: 'blocked', message: busyMessage };

  const between = earlier.pickupAddress && earlier.deliveryAddress ? await travel(earlier.pickupAddress, earlier.deliveryAddress) : null;
  const toNext = earlier.deliveryAddress && later.pickupAddress ? await travel(earlier.deliveryAddress, later.pickupAddress) : null;
  if (between === null || toNext === null) {
    return { status: 'unverified', message: `Travel time against ${other.bookingNo} (pickup ${formatMinutes(otherStart)}) couldn't be checked.` };
  }

  const arrival = earlierStart + between + ON_SITE_MINUTES + toNext;
  if (arrival <= laterStart) return { status: 'available' };
  return {
    status: 'blocked',
    message: targetIsLater
      ? `Busy with ${other.bookingNo}. Can reach this pickup at about ${formatMinutes(arrival)}.`
      : `Has ${other.bookingNo} at ${formatMinutes(otherStart)}. This job would reach it at about ${formatMinutes(arrival)}.`,
  };
}

/** Blocked beats unverified, which beats available. */
export function worstTiming(results: TimingResult[]): TimingResult {
  return results.find((result) => result.status === 'blocked')
    ?? results.find((result) => result.status === 'unverified')
    ?? { status: 'available' };
}
