import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { BmsRoles, DispatchAuthGuard } from '../dispatch-auth.guard';
import { DispatchService } from './dispatch.service';

@Controller('dispatch')
@UseGuards(DispatchAuthGuard)
@BmsRoles('ADMIN', 'OPERATIONS')
export class DispatchController {
  constructor(private readonly dispatch: DispatchService) {}

  @Get('assignments')
  assignments() { return this.dispatch.assignments(); }

  @Get('assignments/:bookingUuid')
  assignment(@Param('bookingUuid') bookingUuid: string) { return this.dispatch.assignment(bookingUuid); }

  @Post('assignments/:bookingUuid/retry')
  retryAssignment(@Param('bookingUuid') bookingUuid: string) { return this.dispatch.retryAssignment(bookingUuid); }

  @Post('assignments/:bookingUuid/release') @BmsRoles('ADMIN')
  releaseForReview(@Param('bookingUuid') bookingUuid: string) { return this.dispatch.releaseForReview(bookingUuid); }

  @Get('job-orders')
  jobOrders() { return this.dispatch.jobOrders(); }

  @Get('job-orders/:id')
  jobOrder(@Param('id') id: string) { return this.dispatch.jobOrder(id); }
}
