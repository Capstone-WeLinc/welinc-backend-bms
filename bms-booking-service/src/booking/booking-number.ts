import { Prisma } from '@prisma/client';

/** Allocate an immutable number from the current Manila-day range. */
export async function nextBookingNumber(tx: Prisma.TransactionClient, at = new Date()): Promise<string> {
  const datePrefix = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at).replace(/-/g, '');

  // Serialize allocations for this date so concurrent API and webhook inserts
  // cannot choose the same suffix. Transaction rollbacks do not consume numbers.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`booking-number:${datePrefix}`}))::text`;
  const bookingPattern = `BN-${datePrefix}-%`;
  const rows = await tx.$queryRaw<Array<{ value: bigint }>>`
    SELECT COALESCE(MAX(used_suffix), 0) + 1 AS value
    FROM (
      SELECT split_part(booking_no, '-', 3)::bigint AS used_suffix
      FROM bookings
      WHERE booking_no LIKE ${bookingPattern}
        AND split_part(booking_no, '-', 3) ~ '^[0-9]+$'
      UNION ALL
      SELECT split_part(deleted_booking.booking_no, '-', 3)::bigint AS used_suffix
      FROM welinc_webhook_events AS webhook_event
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(webhook_event.payload->'deletedBookingNos') = 'array'
          THEN webhook_event.payload->'deletedBookingNos' ELSE '[]'::jsonb END
      ) AS deleted_booking(booking_no)
      WHERE webhook_event.result = 'DELETED'
        AND deleted_booking.booking_no LIKE ${bookingPattern}
        AND split_part(deleted_booking.booking_no, '-', 3) ~ '^[0-9]+$'
    ) AS allocated
  `;

  return `BN-${datePrefix}-${String(rows[0].value).padStart(5, '0')}`;
}
