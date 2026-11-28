import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { BmsRoles, DispatchAuthGuard } from '../dispatch-auth.guard';
import { DispatchService } from './dispatch.service';
import { TeamJobOrdersService } from './team-job-orders';

type ActorRequest = Request & { bmsIdentity?: { sub?: string } };

@Controller('job-order')
@UseGuards(DispatchAuthGuard)
@BmsRoles('ADMIN', 'OPERATIONS')
export class JobOrderController {
  constructor(private readonly dispatch: DispatchService, private readonly team: TeamJobOrdersService) {}

  /** The signed-in driver's or helper's own job orders, for the mobile app (spec bms/0022). Before `:id`. */
  @Get('mine') @BmsRoles('DRIVER', 'HELPER')
  mine(@Req() request: ActorRequest) { return this.team.mine(request.bmsIdentity?.sub ?? ''); }

  @Get() list() { return this.dispatch.legacyJobOrders(); }
  @Get('assigned-bookings') assignedBookings() { return this.dispatch.assignedBookings(); }
  @Get(':id') get(@Param('id') id: string) { return this.dispatch.legacyJobOrder(id); }
  @Post() create(@Body() body: { bookingId: string }) { return this.dispatch.generateJobOrder(body.bookingId); }
  @Put(':id') update(@Param('id') id: string, @Body() body: { status?: string }) { return this.dispatch.updateJobOrder(id, body); }
  @Put(':id/distribute') distribute(@Param('id') id: string) { return this.dispatch.updateJobOrder(id, { status: 'Distributed' }); }
}
