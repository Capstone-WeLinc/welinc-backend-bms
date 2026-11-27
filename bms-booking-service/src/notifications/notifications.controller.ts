import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { BmsRoles, BookingAuthGuard } from '../booking-auth.guard';
import { MAX_BATCH, parseNotificationInput } from './notification-input';
import { NotificationsService, type Viewer } from './notifications.service';

type ViewerRequest = Request & { bmsIdentity?: { sub?: string; roles?: { role: string; system: string }[] } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The signed-in person and every BMS role they hold. */
function viewer(request: ViewerRequest): Viewer {
  const identity = request.bmsIdentity!;
  return {
    userId: identity.sub!,
    roles: [...new Set((identity.roles ?? []).filter((item) => item.system === 'BMS').map((item) => item.role))],
  };
}

/** The bell (spec bms/0021): every BMS role reads its own notifications; drivers and helpers from the mobile app later. */
@Controller('notifications')
@UseGuards(BookingAuthGuard)
@BmsRoles('ADMIN', 'CUSTOMER_SUPPORT', 'OPERATIONS', 'DRIVER', 'HELPER')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Req() request: ViewerRequest) { return this.notifications.list(viewer(request)); }

  @Post('read-all') @HttpCode(200)
  readAll(@Req() request: ViewerRequest) { return this.notifications.markAllRead(viewer(request)); }

  @Post(':id/read') @HttpCode(200)
  read(@Param('id') id: string, @Req() request: ViewerRequest) {
    if (!UUID.test(id)) throw new BadRequestException('Invalid notification ID');
    return this.notifications.markRead(id, viewer(request));
  }
}

function authenticate(provided: string | undefined) {
  const expected = process.env.BMS_INTERNAL_SERVICE_KEY;
  if (!expected || expected.length < 32 || !provided) throw new UnauthorizedException();
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new UnauthorizedException();
}

/** Dispatch and Completion deliver their notifications here from their outboxes. */
@Controller('internal/notifications')
export class InternalNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post() @HttpCode(200)
  receive(@Headers('x-bms-service-key') key: string, @Body() body: { items?: unknown }) {
    authenticate(key);
    if (!Array.isArray(body?.items) || body.items.length > MAX_BATCH) {
      throw new BadRequestException(`Send items: 1 to ${MAX_BATCH} notifications`);
    }
    return this.notifications.receive(body.items.map(parseNotificationInput));
  }
}
