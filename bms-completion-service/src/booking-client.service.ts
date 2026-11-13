import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

export type BookingRecord = {
  id: string; bookingId: string; bookingNo: string; client: string; service: string;
  date: string; status: string; version: number; amount: string | number | null;
  protectiveMaterials: string[];
  requestedPaymentMethod?: string | null;
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
    if (response.status === 409) throw new ConflictException(await response.text());
    if (response.status === 404) throw new NotFoundException('Booking not found');
    if (!response.ok) throw new ServiceUnavailableException(`Booking service returned ${response.status}`);
    return response.json() as Promise<T>;
  }

  list() { return this.request<BookingRecord[]>('/internal/booking'); }
  get(id: string) { return this.request<BookingRecord>(`/internal/booking/${encodeURIComponent(id)}`); }
  async resolve(idOrAlias: string) {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrAlias)) return this.get(idOrAlias);
    const item = (await this.list()).find((booking) => booking.bookingId === idOrAlias);
    if (!item) throw new NotFoundException('Booking not found');
    return item;
  }
  command(id: string, body: Record<string, unknown>) {
    return this.request<{ applied: boolean; duplicate: boolean; version: number; status: string }>(
      `/internal/booking/${encodeURIComponent(id)}/commands`, 'POST', body);
  }
}
