import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export type DispatchSnapshot = { garage: string; deliveryType: string; plateNumber: string; assignedTeam: string };

@Injectable()
export class DispatchClient {
  async postServiceReadyBookingUuids(): Promise<string[]> {
    const key = process.env.BMS_INTERNAL_SERVICE_KEY;
    if (!key || key.length < 32) throw new ServiceUnavailableException('Internal service identity is not configured');
    const root = process.env.DISPATCH_API_URL || 'http://127.0.0.1:3003';
    try {
      const response = await fetch(new URL('/internal/dispatch/post-service-ready', root), {
        headers: { 'x-bms-service-key': key }, signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error('Dispatch readiness unavailable');
      const body = await response.json() as { bookingUuids?: unknown };
      if (!Array.isArray(body.bookingUuids) || body.bookingUuids.some((id) => typeof id !== 'string')) throw new Error('Invalid dispatch readiness response');
      return body.bookingUuids;
    } catch { throw new ServiceUnavailableException('Dispatch readiness unavailable'); }
  }

  async snapshot(bookingUuid: string): Promise<DispatchSnapshot> {
    const key = process.env.BMS_INTERNAL_SERVICE_KEY;
    if (!key || key.length < 32) throw new ServiceUnavailableException('Internal service identity is not configured');
    const root = process.env.DISPATCH_API_URL || 'http://127.0.0.1:3003';
    try {
      const [assignment, order] = await Promise.all(['assignments', 'job-orders'].map((kind) => fetch(
        new URL(`/internal/dispatch/${kind}/${encodeURIComponent(bookingUuid)}`, root),
        { headers: { 'x-bms-service-key': key }, signal: AbortSignal.timeout(8000) },
      )));
      if (!assignment.ok || !order.ok) throw new Error('Dispatch read unavailable');
      const [assignmentBody, orderBody] = await Promise.all([assignment.json(), order.json()]);
      const a = assignmentBody.item;
      const o = orderBody.item;
      return {
        garage: String(a?.garage ?? 'Unassigned'),
        deliveryType: String(a?.deliveryType ?? 'Inhouse'),
        plateNumber: String(o?.truck ?? 'N/A'),
        assignedTeam: String(o?.team ?? 'Unassigned'),
      };
    } catch { throw new ServiceUnavailableException('Dispatch details unavailable; retry collection entry'); }
  }
}
