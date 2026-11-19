import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  live() { return { status: 'ok' }; }

  @Get('ready')
  async ready() {
    try {
      await this.prisma.checkReady();
      return { status: 'ok', completionDatabase: 'ok' };
    } catch {
      throw new ServiceUnavailableException('Completion database is unavailable');
    }
  }
}
