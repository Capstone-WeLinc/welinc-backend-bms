import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { BmsRoles, DispatchAuthGuard } from '../dispatch-auth.guard';
import { DispatchService } from './dispatch.service';

@Controller('scheduling')
@UseGuards(DispatchAuthGuard)
@BmsRoles('ADMIN', 'OPERATIONS')
export class SchedulingController {
  constructor(private readonly dispatch: DispatchService) {}

  @Get()
  list() { return this.dispatch.schedules(); }

  @Get(':id')
  get(@Param('id') id: string) { return this.dispatch.schedule(id); }

  @Get(':id/resource-timing')
  resourceTiming(@Param('id') id: string) { return this.dispatch.resourceTiming(id); }

  @Put(':id/assign')
  @BmsRoles('OPERATIONS')
  assign(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() request: Request & { user?: { sub?: string } }) {
    return this.dispatch.assign(id, body, request.user?.sub ?? '');
  }
}
