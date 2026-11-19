import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BmsAuthModule } from './auth/bms-auth.module';
import { validateEnv } from './config/env';
import { PrismaService } from './prisma.service';
import { CompletionAuthGuard } from './completion-auth.guard';
import { HealthController } from './health.controller';
import { BookingClient } from './booking-client.service';
import { DispatchClient } from './dispatch-client.service';
import { CollectionsController } from './collections/collections.controller';
import { CollectionsService } from './collections/collections.service';
import { WorkController } from './work/work.controller';
import { WorkService } from './work/work.service';
import { AuditController, AuditProvider } from './audit';
import { InternalCompletionController } from './internal-completion.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }), BmsAuthModule],
  controllers: [HealthController, CollectionsController, WorkController, AuditController, InternalCompletionController],
  providers: [PrismaService, CompletionAuthGuard, BookingClient, DispatchClient, CollectionsService, WorkService, AuditProvider],
})
export class AppModule {}
