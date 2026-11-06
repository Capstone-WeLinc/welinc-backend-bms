import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { BmsRoles, CompletionAuthGuard } from '../completion-auth.guard';
import { CollectionsService } from './collections.service';

type ActorRequest = Request & { bmsIdentity?: { sub?: string } };
const actor = (request: ActorRequest) => request.bmsIdentity!.sub!;

@Controller()
@UseGuards(CompletionAuthGuard)
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Post('collections') @BmsRoles('ADMIN', 'CUSTOMER_SUPPORT')
  create(@Body() body: Record<string, unknown>, @Req() request: ActorRequest) { return this.collections.create(body, actor(request)); }

  @Get('collections/eligible-bookings') @BmsRoles('ADMIN', 'CUSTOMER_SUPPORT')
  eligibleBookings() { return this.collections.eligibleBookings(); }

  @Get('collections/pending') @BmsRoles('ADMIN')
  pending() { return this.collections.pending(); }

  @Get('collections') @BmsRoles('ADMIN')
  all() { return this.collections.all(); }

  @Get('collections/refunds/pending') @BmsRoles('ADMIN')
  pendingRefunds() { return this.collections.pendingRefunds(); }

  @Post('collections/refunds/:id/retry') @BmsRoles('ADMIN')
  retryRefund(@Param('id') id: string) { return this.collections.retryRefund(id); }

  @Post('collections/:id/verify') @BmsRoles('ADMIN')
  verify(@Param('id') id: string, @Req() request: ActorRequest) { return this.collections.verify(id, actor(request)); }

  @Post('collections/:id/reject') @BmsRoles('ADMIN')
  reject(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() request: ActorRequest) { return this.collections.reject(id, actor(request), String(body.reason ?? '')); }

  @Post('collections/:id/refunds') @BmsRoles('ADMIN')
  refund(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() request: ActorRequest) {
    return this.collections.refund(id, body, actor(request));
  }

  @Post('collections/:id/refund-requests') @BmsRoles('CUSTOMER_SUPPORT')
  requestRefund(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() request: ActorRequest) {
    return this.collections.requestRefund(id, body, actor(request));
  }

  @Get('daily-sales') @BmsRoles('ADMIN', 'CUSTOMER_SUPPORT')
  sales(@Query('submittedOnly') submittedOnly?: string) { return this.collections.sales(submittedOnly === 'true'); }

  @Get('daily-sales/summary') @BmsRoles('ADMIN', 'CUSTOMER_SUPPORT')
  summary(@Query('date') date?: string) { return this.collections.summary(date); }

  @Post('daily-sales/submit') @BmsRoles('CUSTOMER_SUPPORT', 'ADMIN')
  submit(@Query('date') date: string, @Req() request: ActorRequest) { return this.collections.submit(date, actor(request)); }
}
