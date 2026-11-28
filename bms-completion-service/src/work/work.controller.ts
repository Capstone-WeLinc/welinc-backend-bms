import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { BmsRoles, CompletionAuthGuard } from '../completion-auth.guard';
import { WorkService } from './work.service';

type ActorRequest = Request & { bmsIdentity?: { sub?: string } };

@Controller('post-service')
@UseGuards(CompletionAuthGuard)
@BmsRoles('ADMIN', 'CUSTOMER_SUPPORT')
export class WorkController {
  constructor(private readonly work: WorkService) {}

  // The driver's own forms from the mobile app (spec bms/0022). Declared before `:id`.
  @Get('mine') @BmsRoles('DRIVER') mine(@Req() request: ActorRequest) { return this.work.teamStatus(request.bmsIdentity!.sub!); }
  @Put('mine/:bookingUuid') @BmsRoles('DRIVER')
  submitMine(@Param('bookingUuid') bookingUuid: string, @Body() body: Record<string, unknown>, @Req() request: ActorRequest) {
    return this.work.submitFromTeam(bookingUuid, body ?? {}, request.bmsIdentity!.sub!);
  }

  @Get() @BmsRoles('ADMIN', 'CUSTOMER_SUPPORT', 'OPERATIONS') list() { return this.work.list(); }
  @Get('pending') @BmsRoles('ADMIN') pending() { return this.work.pending(); }
  @Get(':id') @BmsRoles('ADMIN', 'CUSTOMER_SUPPORT', 'OPERATIONS') get(@Param('id') id: string) { return this.work.get(id); }
  @Post(':id/retry') @BmsRoles('ADMIN') retry(@Param('id') id: string, @Req() request: ActorRequest) {
    return this.work.retry(id, request.bmsIdentity!.sub!);
  }
  @Put(':id') upsert(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() request: ActorRequest) {
    return this.work.upsert(id, body, request.bmsIdentity!.sub!);
  }
}
