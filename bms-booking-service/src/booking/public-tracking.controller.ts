import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { BookingService } from './booking.service';

@Controller('public/tracking')
export class PublicTrackingController {
  constructor(private readonly bookings: BookingService) {}

  @Get(':bookingId')
  tracking(@Param('bookingId') bookingId: string, @Query('token') token: string) {
    if (!token) throw new NotFoundException('Tracking link is invalid or expired');
    return this.bookings.getCustomerTracking(bookingId, token);
  }
}
