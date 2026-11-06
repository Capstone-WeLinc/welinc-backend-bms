import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { BmsRoles, CompletionAuthGuard } from '../completion-auth.guard';
import { WorkService } from './work.service';

@Controller('post-service')
@UseGuards(CompletionAuthGuard)
@BmsRoles('ADMIN', 'CUSTOMER_SUPPORT')
export class WorkController {
  constructor(private readonly work: WorkService) {}
  @Get() @BmsRoles('ADMIN', 'CUSTOMER_SUPPORT', 'OPERATIONS') list() { return this.work.list(); }
  @Get('pending') @BmsRoles('ADMIN') pending() { return this.work.pending(); }
  @Get(':id') @BmsRoles('ADMIN', 'CUSTOMER_SUPPORT', 'OPERATIONS') get(@Param('id') id: string) { return this.work.get(id); }
  @Post(':id/retry') @BmsRoles('ADMIN') retry(@Param('id') id: string, @Req() request: Request & { bmsIdentity?: { sub?: string } }) {
    return this.work.retry(id, request.bmsIdentity!.sub!);
  }
  @Put(':id') upsert(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() request: Request & { bmsIdentity?: { sub?: string } }) {
    return this.work.upsert(id, body, request.bmsIdentity!.sub!);
  }
}
