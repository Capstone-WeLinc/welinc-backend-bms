import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { BmsRoles, DispatchAuthGuard } from '../dispatch-auth.guard';
import { CrewLeaveService } from './crew-leave.service';

type ActorRequest = Request & { bmsIdentity?: { sub?: string } };
const actor = (request: ActorRequest) => request.bmsIdentity?.sub ?? '';

/** Operations files and tracks crew leave; Admin decides it through the Approvals page. */
@Controller('crew-leave')
@UseGuards(DispatchAuthGuard)
export class CrewLeaveController {
  constructor(private readonly leave: CrewLeaveService) {}

  @Post() @BmsRoles('OPERATIONS')
  file(@Body() body: Record<string, unknown>, @Req() request: ActorRequest) { return this.leave.file(body ?? {}, actor(request)); }

  @Get('mine') @BmsRoles('OPERATIONS')
  mine(@Req() request: ActorRequest) { return this.leave.mine(actor(request)); }

  @Post(':id/withdraw') @BmsRoles('OPERATIONS')
  withdraw(@Param('id') id: string, @Req() request: ActorRequest) { return this.leave.withdraw(id, actor(request)); }

  @Get('active') @BmsRoles('ADMIN', 'OPERATIONS')
  active(@Query('from') from?: string) { return this.leave.active(from || undefined); }

  @Get('conflicts') @BmsRoles('ADMIN', 'OPERATIONS')
  conflicts() { return this.leave.conflicts(); }

  // Declared last so it never shadows 'mine', 'active' or 'conflicts'.
  @Get(':id') @BmsRoles('OPERATIONS')
  detail(@Param('id') id: string, @Req() request: ActorRequest) { return this.leave.mineDetail(id, actor(request)); }
}
