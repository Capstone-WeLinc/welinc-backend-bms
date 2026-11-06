import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { BookingAuthGuard, BmsRoles } from '../booking-auth.guard';
import { BookingService } from './booking.service';
import { CreateBookingDto, UpdateBookingDto } from './booking.dto';
import { BookingRouteDto } from './booking-route.dto';
import { BookingRouteService } from './booking-route.service';
import { ApprovalsService } from './approvals.service';

type ActorRequest = Request & { bmsIdentity?: { sub?: string } };
const actor = (request: ActorRequest) => request.bmsIdentity!.sub!;

@Controller('booking')
@UseGuards(BookingAuthGuard)
export class BookingController {
  constructor(private readonly bookings: BookingService, private readonly routes: BookingRouteService, private readonly approvals: ApprovalsService) {}

  @Post('route')
  @BmsRoles('ADMIN', 'CUSTOMER_SUPPORT')
  route(@Body() input: BookingRouteDto) {
    return this.routes.calculateRoute(input.pickupAddress, input.deliveryAddress, input.pickupLandmark, input.deliveryLandmark);
  }

  @Get('truck-rates')
  @BmsRoles('CUSTOMER_SUPPORT')
  truckRates(@Query('location') location: string, @Query('truckTypeId') truckTypeId: string) {
    if (!location?.trim() || !truckTypeId?.trim()) {
      throw new BadRequestException('location and truckTypeId are required');
    }
    return this.bookings.truckRates(location.trim(), truckTypeId.trim());
  }

  @Get()
  @BmsRoles('ADMIN', 'OPERATIONS', 'CUSTOMER_SUPPORT')
  list() { return this.bookings.list(); }

  @Get(':id')
  @BmsRoles('ADMIN', 'OPERATIONS', 'CUSTOMER_SUPPORT')
  get(@Param('id') id: string) { return this.bookings.get(id); }

  @Post(':id/change-requests')
  @BmsRoles('CUSTOMER_SUPPORT')
  requestChange(@Param('id') id: string, @Body() input: Record<string, unknown>, @Req() request: ActorRequest) {
    return this.approvals.submitChange(id, input, actor(request));
  }

  @Post()
  @BmsRoles('ADMIN', 'CUSTOMER_SUPPORT')
  create(@Body() input: CreateBookingDto, @Req() request: ActorRequest) { return this.bookings.create(input, actor(request)); }

  @Put(':id/details')
  @BmsRoles('CUSTOMER_SUPPORT')
  updateDetails(@Param('id') id: string, @Body() input: Record<string, unknown>, @Req() request: ActorRequest) {
    return this.bookings.updateDetails(id, input, actor(request));
  }

  @Put(':id')
  @BmsRoles('ADMIN')
  update(@Param('id') id: string, @Body() input: UpdateBookingDto, @Req() request: ActorRequest) { return this.bookings.update(id, input, actor(request)); }
}
