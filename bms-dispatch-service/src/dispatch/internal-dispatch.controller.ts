import { ConflictException, Controller, Get, Headers, Param, Post, Body, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { DispatchService } from './dispatch.service';

@Controller('internal/dispatch')
export class InternalDispatchController {
  constructor(private readonly prisma: PrismaService, private readonly dispatch: DispatchService) {}
  private authenticate(key: string) {
    const expected = process.env.BMS_INTERNAL_SERVICE_KEY;
    if (!expected || expected.length < 32 || !key || Buffer.byteLength(key) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(key), Buffer.from(expected))) throw new UnauthorizedException();
  }
  @Get('assignments')
  list(@Headers('x-bms-service-key') key: string) {
    this.authenticate(key);
    return this.prisma.dispatchAssignment.findMany({ where: { state: 'CONFIRMED' } });
  }
  @Get('job-orders/:bookingUuid')
  async jobOrder(@Param('bookingUuid') bookingUuid: string, @Headers('x-bms-service-key') key: string) {
    this.authenticate(key);
    return { item: await this.prisma.dispatchJobOrder.findUnique({ where: { bookingUuid } }) };
  }
  @Get('assignments/:bookingUuid')
  async assignment(@Param('bookingUuid') bookingUuid: string, @Headers('x-bms-service-key') key: string) {
    this.authenticate(key);
    return { item: await this.prisma.dispatchAssignment.findUnique({ where: { bookingUuid } }) };
  }
  @Get('tracking/:bookingUuid')
  async tracking(@Param('bookingUuid') bookingUuid: string, @Headers('x-bms-service-key') key: string) {
    this.authenticate(key);
    return this.dispatch.tracking(bookingUuid);
  }
  @Get('post-service-ready')
  async postServiceReady(@Headers('x-bms-service-key') key: string) {
    this.authenticate(key);
    return { bookingUuids: await this.dispatch.postServiceReadyBookingUuids() };
  }
  @Get('booking-state/:bookingUuid')
  async bookingState(@Param('bookingUuid') bookingUuid: string, @Headers('x-bms-service-key') key: string) {
    this.authenticate(key);
    const order = await this.prisma.dispatchJobOrder.findUnique({ where: { bookingUuid } });
    return { distributed: order?.status === 'Distributed' };
  }
  @Post('validate-assignment/:bookingUuid')
  async validateAssignment(@Param('bookingUuid') bookingUuid: string, @Headers('x-bms-service-key') key: string, @Body() body: Record<string, unknown>) {
    this.authenticate(key);
    return this.dispatch.validateAssignment(bookingUuid, body);
  }
  @Post('approvals/:eventId')
  async approvalEffect(@Param('eventId') eventId: string, @Headers('x-bms-service-key') key: string, @Body() body: Record<string, unknown>) {
    this.authenticate(key);
    if (await this.prisma.approvalEventReceipt.findUnique({ where: { eventId } })) return { duplicate: true };
    const bookingUuid = String(body.bookingUuid ?? '');
    const type = String(body.type ?? '');
    const eventType = String(body.eventType ?? '');
    return this.prisma.$transaction(async (tx) => {
      await tx.approvalEventReceipt.create({ data: { eventId } });
      const order = await tx.dispatchJobOrder.findUnique({ where: { bookingUuid } });
      if (order?.status === 'Distributed') throw new ConflictException('A distributed trip cannot be changed');
      if (type === 'edit' && body.needsUpdate === true) {
        await tx.dispatchJobOrder.updateMany({ where: { bookingUuid }, data: { needsUpdate: true, updatedAt: new Date() } });
      }
      if (type === 'reschedule' || type === 'cancel' || eventType === 'BOOKING_CANCEL_APPROVED') {
        await tx.dispatchAssignment.updateMany({ where: { bookingUuid, state: 'CONFIRMED' }, data: { state: 'REJECTED', lastError: null, updatedAt: new Date() } });
        if (order) await tx.dispatchJobOrder.update({ where: { id: order.id }, data: { state: 'SUPERSEDED', status: type === 'cancel' ? 'Cancelled' : 'Pending', updatedAt: new Date() } });
      }
      return { applied: true };
    });
  }
}
