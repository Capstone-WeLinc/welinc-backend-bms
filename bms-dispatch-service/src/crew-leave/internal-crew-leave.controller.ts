import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { CrewLeaveService } from './crew-leave.service';

/** Called only by the booking service, which runs the Admin Approvals page. */
@Controller('internal/dispatch/crew-leave')
export class InternalCrewLeaveController {
  constructor(private readonly leave: CrewLeaveService) {}

  private authenticate(key: string) {
    const expected = process.env.BMS_INTERNAL_SERVICE_KEY;
    if (!expected || expected.length < 32 || !key || Buffer.byteLength(key) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(key), Buffer.from(expected))) throw new UnauthorizedException();
  }

  @Get()
  list(@Headers('x-bms-service-key') key: string, @Query('status') status?: string) {
    this.authenticate(key);
    return this.leave.approvalItems(status);
  }

  @Get(':id')
  detail(@Headers('x-bms-service-key') key: string, @Param('id') id: string) {
    this.authenticate(key);
    return this.leave.approvalDetail(id);
  }

  @Post(':id/:decision')
  decide(@Headers('x-bms-service-key') key: string, @Param('id') id: string, @Param('decision') decision: string,
    @Body() body: { actor?: string; reason?: string }) {
    this.authenticate(key);
    if (decision !== 'approve' && decision !== 'reject') throw new BadRequestException('Unsupported decision');
    if (!body?.actor) throw new BadRequestException('Actor is required');
    return this.leave.decide(id, body.actor, decision, body.reason ?? '');
  }
}
