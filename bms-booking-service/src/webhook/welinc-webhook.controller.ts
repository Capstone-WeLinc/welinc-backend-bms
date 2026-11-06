import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { WelincWebhookService } from './welinc-webhook.service';
import { BmsRoles, BookingAuthGuard } from '../booking-auth.guard';

@Controller('integrations')
export class WelincWebhookController {
  constructor(private readonly webhook: WelincWebhookService) {}

  @Get(['welinc/bookings', 'wix/bookings'])
  ping() {
    return { status: 'ok', message: 'WeLinc Webhook receiver is active. Send POST requests to this URL to submit booking events.' };
  }

  @Post(['welinc/bookings', 'wix/bookings'])
  @HttpCode(202)
  receive(@Req() request: RawBodyRequest<Request>) { return this.webhook.receive(request); }

  @Get(['welinc/review', 'wix/review'])
  @UseGuards(BookingAuthGuard)
  @BmsRoles('ADMIN')
  pendingReview() { return this.webhook.pendingReview(); }

  @Get(['welinc/notifications', 'wix/notifications'])
  @UseGuards(BookingAuthGuard)
  @BmsRoles('ADMIN')
  importedBookingNotifications() { return this.webhook.importedBookingNotifications(); }

  @Get(['welinc/notifications/deleted', 'wix/notifications/deleted'])
  @UseGuards(BookingAuthGuard)
  @BmsRoles('ADMIN', 'CUSTOMER_SUPPORT', 'OPERATIONS')
  deletedBookingNotificationRefs() { return this.webhook.deletedBookingNotificationRefs(); }

  @Post(['welinc/review/:eventId', 'wix/review/:eventId'])
  @UseGuards(BookingAuthGuard)
  @BmsRoles('ADMIN')
  review(@Param('eventId') eventId: string, @Body() body: { action?: string; note?: string },
    @Req() request: Request & { bmsIdentity?: { sub: string } }) {
    return this.webhook.review(eventId, body.action, body.note, request.bmsIdentity!.sub);
  }
}
