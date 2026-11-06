import { Body, Controller, Get, Headers, Param, Post, Query, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { PrismaService } from './prisma.service';
import { CollectionsService } from './collections/collections.service';

@Controller('internal/completion')
export class InternalCompletionController {
  constructor(private readonly prisma: PrismaService, private readonly collections: CollectionsService) {}
  private authenticate(key: string) {
    const expected = process.env.BMS_INTERNAL_SERVICE_KEY;
    if (!expected || expected.length < 32 || !key || Buffer.byteLength(key) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(key), Buffer.from(expected))) throw new UnauthorizedException();
  }
  @Get('approvals')
  approvals(@Headers('x-bms-service-key') key: string, @Query('status') status?: string) { this.authenticate(key); return this.collections.approvalItems(status); }
  @Get('approvals/mine')
  mine(@Headers('x-bms-service-key') key: string, @Query('actor') actor: string) { this.authenticate(key); return this.collections.approvalMine(actor); }
  @Get('approvals/:type/:id')
  approvalDetail(@Headers('x-bms-service-key') key: string, @Param('type') type: string, @Param('id') id: string, @Query('actor') actor: string, @Query('admin') admin: string) {
    this.authenticate(key); return this.collections.approvalDetail(type, id, actor, admin === 'true');
  }
  @Post('approvals/:type/:id/:action')
  decideOrChange(@Headers('x-bms-service-key') key: string, @Param('type') type: string, @Param('id') id: string, @Param('action') action: string, @Body() body: { actor: string; reason?: string; input?: Record<string, unknown> }) {
    this.authenticate(key);
    if (action === 'approve' || action === 'reject') return this.collections.decideApproval(type, id, body.actor, action, body.reason ?? '');
    if (action === 'withdraw' || action === 'resubmit') return this.collections.changeApprovalStatus(type, id, body.actor, action, body.input ?? {});
    throw new UnauthorizedException();
  }
  @Post('approvals/cancel-booking/:eventId')
  async cancelBooking(@Headers('x-bms-service-key') key: string, @Param('eventId') eventId: string, @Body() body: Record<string, unknown>) {
    this.authenticate(key);
    const existing = await this.prisma.approvalEventReceipt.findUnique({ where: { eventId } });
    if (existing) return { duplicate: true };
    const bookingUuid = String(body.bookingUuid ?? '');
    return this.prisma.$transaction(async (tx) => {
      await tx.approvalEventReceipt.create({ data: { eventId } });
      const actor = String(body.decidedBy ?? body.requestedBy);
      const collectionRows = await tx.collection.findMany({ where: { bookingUuid, status: { in: ['PENDING', 'VERIFYING'] } }, select: { id: true } });
      await tx.collection.updateMany({ where: { bookingUuid, status: { in: ['PENDING', 'VERIFYING'] } }, data: { status: 'WITHDRAWN' } });
      const refundRows = await tx.refundRequest.findMany({ where: { bookingUuid, status: 'Requested' }, select: { id: true } });
      await tx.refundRequest.updateMany({ where: { bookingUuid, status: 'Requested' }, data: { status: 'Withdrawn', decidedBy: actor, decidedAt: new Date(), decisionReason: 'Booking cancelled' } });
      for (const item of collectionRows) await tx.approvalAuditEvent.create({ data: { itemType: 'collection', itemId: item.id, actorId: actor, action: 'withdrawn', reason: 'Booking cancelled' } });
      for (const item of refundRows) await tx.approvalAuditEvent.create({ data: { itemType: 'refund', itemId: item.id, actorId: actor, action: 'withdrawn', reason: 'Booking cancelled' } });
      const verified = await tx.collection.findMany({ where: { bookingUuid, status: 'VERIFIED' } });
      let refundRequestsCreated = 0;
      for (const collection of verified) {
        const refunds = await tx.refund.findMany({ where: { collectionId: collection.id } });
        const pending = await tx.refundRequest.findMany({ where: { collectionId: collection.id, status: 'Requested' } });
        const remainingCents = Math.round(Number(collection.amount) * 100) - refunds.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0) - pending.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0);
        if (remainingCents <= 0) continue;
        const refundRequest = await tx.refundRequest.create({ data: {
          collectionId: collection.id, bookingUuid, bookingNo: collection.bookingNo, clientName: collection.clientName,
          amount: (remainingCents / 100).toFixed(2), reason: 'Booking cancelled; refund for verified payment',
          requestedBy: actor,
        } });
        await tx.approvalAuditEvent.create({ data: { itemType: 'refund', itemId: refundRequest.id, actorId: actor, action: 'submitted', reason: refundRequest.reason } });
        refundRequestsCreated += 1;
      }
      return { withdrawn: true, refundRequestsCreated };
    });
  }
  @Get('read-model')
  async readModel(@Headers('x-bms-service-key') key: string) {
    const expected = process.env.BMS_INTERNAL_SERVICE_KEY;
    if (!expected || expected.length < 32 || !key || Buffer.byteLength(key) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(key), Buffer.from(expected))) throw new UnauthorizedException();
    const [work, collections, refunds] = await Promise.all([
      this.prisma.workOutcome.findMany(),
      this.prisma.collection.findMany({ where: { status: 'VERIFIED' } }),
      this.prisma.refund.findMany({ where: { projectionState: 'SYNCED' } }),
    ]);
    return { work, collections, refunds };
  }
}
