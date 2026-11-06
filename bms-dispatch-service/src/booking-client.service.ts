import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';

export type BookingRecord = {
  id: string; bookingId: string; bookingNo: string; client: string; service: string;
  date: string; status: string; version: number; amount: string | number | null;
  operationalHold?: boolean; paymentHold?: boolean;
  pickupAddress: string | null; deliveryAddress: string | null; preferredTime: string | null;
};
@Injectable()
export class BookingClient {
  private async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const key = process.env.BMS_INTERNAL_SERVICE_KEY;
    if (!key || key.length < 32) throw new ServiceUnavailableException('Internal service identity is not configured');
    const root = process.env.BOOKING_API_URL || 'http://127.0.0.1:3002';
    let response: Response;
    try {
      response = await fetch(new URL(path, root), {
        method, headers: { 'x-bms-service-key': key, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000),
      });
    } catch { throw new ServiceUnavailableException('Booking service unavailable'); }
    if (!response.ok) {
      const text = await response.text();
      let message = text;
      try {
        const body = JSON.parse(text) as { message?: unknown };
        if (typeof body.message === 'string') message = body.message;
      } catch { /* Preserve a plain-text upstream response. */ }
      message = message.slice(0, 500);
      if (response.status === 400) throw new BadRequestException(message || 'Booking service rejected the request');
      if (response.status === 409) throw new ConflictException(message || 'Booking service reported a conflict');
      throw new ServiceUnavailableException(`Booking service returned ${response.status}${message ? `: ${message}` : ''}`);
    }
    return response.json() as Promise<T>;
  }

  list() { return this.request<BookingRecord[]>('/internal/booking'); }
  pendingChange(id: string) { return this.request<{ pending: boolean }>(`/internal/booking/${encodeURIComponent(id)}/pending-change`); }
  get(id: string) { return this.request<BookingRecord>(`/internal/booking/${encodeURIComponent(id)}`); }
  route(pickupAddress: string, deliveryAddress: string) {
    return this.request<{ durationMin: number }>('/internal/booking/route', 'POST', { pickupAddress, deliveryAddress });
  }
  command(id: string, body: Record<string, unknown>) {
    return this.request<{ applied: boolean; duplicate: boolean; version: number; status: string }>(
      `/internal/booking/${encodeURIComponent(id)}/commands`, 'POST', body);
  }
}
