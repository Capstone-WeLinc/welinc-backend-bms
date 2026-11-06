import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { BmsRoles, DispatchAuthGuard } from '../dispatch-auth.guard';
import { DispatchService } from './dispatch.service';

@Controller('job-order')
@UseGuards(DispatchAuthGuard)
@BmsRoles('ADMIN', 'OPERATIONS')
export class JobOrderController {
  constructor(private readonly dispatch: DispatchService) {}

  @Get() list() { return this.dispatch.legacyJobOrders(); }
  @Get('assigned-bookings') assignedBookings() { return this.dispatch.assignedBookings(); }
  @Get(':id') get(@Param('id') id: string) { return this.dispatch.legacyJobOrder(id); }
  @Post() create(@Body() body: { bookingId: string }) { return this.dispatch.generateJobOrder(body.bookingId); }
  @Put(':id') update(@Param('id') id: string, @Body() body: { status?: string }) { return this.dispatch.updateJobOrder(id, body); }
  @Put(':id/distribute') distribute(@Param('id') id: string) { return this.dispatch.updateJobOrder(id, { status: 'Distributed' }); }
}
