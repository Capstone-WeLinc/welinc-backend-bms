import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { BookingAuthGuard, BmsRoles } from '../booking-auth.guard';
import { ApprovalsService } from './approvals.service';

type ActorRequest = Request & { bmsIdentity?: { sub?: string; role?: string } };
const actor = (request: ActorRequest) => request.bmsIdentity!.sub!;

@Controller('approvals')
@UseGuards(BookingAuthGuard)
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get() @BmsRoles('ADMIN')
  list(@Query() query: Record<string, unknown>) { return this.approvals.list(query); }

  @Get('counts') @BmsRoles('ADMIN')
  counts() { return this.approvals.counts(); }

  @Get('mine') @BmsRoles('CUSTOMER_SUPPORT')
  mine(@Req() request: ActorRequest) { return this.approvals.mine(actor(request)); }

  @Get(':type/:id') @BmsRoles('ADMIN', 'CUSTOMER_SUPPORT')
  detail(@Param('type') type: 'booking' | 'collection' | 'refund', @Param('id') id: string, @Req() request: ActorRequest) {
    const admin = request.bmsIdentity?.role === 'ADMIN';
    return this.approvals.detail(type, id, actor(request), admin);
  }

  @Post(':type/:id/approve') @BmsRoles('ADMIN')
  approve(@Param('type') type: 'booking' | 'collection' | 'refund', @Param('id') id: string, @Req() request: ActorRequest) {
    return this.approvals.decide(type, id, actor(request), 'approve');
  }

  @Post(':type/:id/reject') @BmsRoles('ADMIN')
  reject(@Param('type') type: 'booking' | 'collection' | 'refund', @Param('id') id: string, @Body() body: Record<string, unknown>, @Req() request: ActorRequest) {
    return this.approvals.decide(type, id, actor(request), 'reject', String(body.reason ?? ''));
  }

  @Post(':type/:id/withdraw') @BmsRoles('CUSTOMER_SUPPORT')
  withdraw(@Param('type') type: 'booking' | 'collection' | 'refund', @Param('id') id: string, @Req() request: ActorRequest) {
    return this.approvals.withdraw(type, id, actor(request));
  }

  @Post(':type/:id/resubmit') @BmsRoles('CUSTOMER_SUPPORT')
  resubmit(@Param('type') type: 'booking' | 'collection' | 'refund', @Param('id') id: string, @Body() body: Record<string, unknown>, @Req() request: ActorRequest) {
    return this.approvals.resubmit(type, id, actor(request), body);
  }
}
