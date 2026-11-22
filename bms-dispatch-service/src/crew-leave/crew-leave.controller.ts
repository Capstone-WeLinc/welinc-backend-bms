import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { BmsRoles, DispatchAuthGuard } from '../dispatch-auth.guard';
import { CrewLeaveService } from './crew-leave.service';

type ActorRequest = Request & { bmsIdentity?: { sub?: string } };
const actor = (request: ActorRequest) => request.bmsIdentity?.sub ?? '';

/**
 * Drivers and helpers file and track their own leave (spec bms/0005); Admin decides it through
 * the Approvals page. Admin and Operations only read who is on leave, for Scheduling.
 */
@Controller('crew-leave')
@UseGuards(DispatchAuthGuard)
export class CrewLeaveController {
  constructor(private readonly leave: CrewLeaveService) {}

  @Post('self') @BmsRoles('DRIVER', 'HELPER')
  file(@Body() body: Record<string, unknown>, @Req() request: ActorRequest) { return this.leave.fileSelf(body ?? {}, actor(request)); }

  @Get('self') @BmsRoles('DRIVER', 'HELPER')
  mine(@Req() request: ActorRequest) { return this.leave.selfList(actor(request)); }

  @Get('self/:id') @BmsRoles('DRIVER', 'HELPER')
  detail(@Param('id') id: string, @Req() request: ActorRequest) { return this.leave.selfDetail(id, actor(request)); }

  @Post('self/:id/withdraw') @BmsRoles('DRIVER', 'HELPER')
  withdraw(@Param('id') id: string, @Req() request: ActorRequest) { return this.leave.withdrawSelf(id, actor(request)); }

  @Get('active') @BmsRoles('ADMIN', 'OPERATIONS')
  active(@Query('from') from?: string) { return this.leave.active(from || undefined); }

  @Get('conflicts') @BmsRoles('ADMIN', 'OPERATIONS')
  conflicts() { return this.leave.conflicts(); }
}
