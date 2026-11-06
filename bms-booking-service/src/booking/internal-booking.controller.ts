import { Body, Controller, Get, Headers, Param, Post, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { BookingService } from './booking.service';
import { BookingRouteService } from './booking-route.service';

function authenticate(provided: string | undefined) {
  const expected = process.env.BMS_INTERNAL_SERVICE_KEY;
  if (!expected || expected.length < 32 || !provided) throw new UnauthorizedException();
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new UnauthorizedException();
}

@Controller('internal/booking')
export class InternalBookingController {
  constructor(private readonly bookings: BookingService, private readonly routes: BookingRouteService) {}

  @Get()
  list(@Headers('x-bms-service-key') key: string) {
    authenticate(key);
    return this.bookings.list();
  }

  @Post('route')
  async route(@Body() body: { pickupAddress?: string; deliveryAddress?: string }, @Headers('x-bms-service-key') key: string) {
    authenticate(key);
    const { distanceKm, durationMin } = await this.routes.calculateRoute(String(body.pickupAddress ?? ''), String(body.deliveryAddress ?? ''));
    return { distanceKm, durationMin };
  }

  @Get(':id/pending-change')
  pendingChange(@Param('id') id: string, @Headers('x-bms-service-key') key: string) {
    authenticate(key);
    return this.bookings.hasPendingChange(id);
  }

  @Get(':id')
  get(@Param('id') id: string, @Headers('x-bms-service-key') key: string) {
    authenticate(key);
    return this.bookings.get(id);
  }

  @Post(':id/commands')
  command(@Param('id') id: string, @Body() body: Record<string, unknown>, @Headers('x-bms-service-key') key: string) {
    authenticate(key);
    return this.bookings.command(id, body);
  }

  @Post(':id/tracking-update')
  trackingUpdate(@Param('id') id: string, @Body() body: { update?: string }, @Headers('x-bms-service-key') key: string) {
    authenticate(key);
    return this.bookings.notifyTrackingUpdate(id, String(body.update ?? ''));
  }
}
