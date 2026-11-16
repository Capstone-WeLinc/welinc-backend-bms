import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BmsAuthModule } from './auth/bms-auth.module';
import { validateEnv } from './config/env';
import { PrismaService } from './prisma.service';
import { DispatchAuthGuard } from './dispatch-auth.guard';
import { HealthController } from './health.controller';
import { DispatchController } from './dispatch/dispatch.controller';
import { DispatchService } from './dispatch/dispatch.service';
import { FleetController } from './fleet/fleet.controller';
import { FleetService } from './fleet/fleet.service';
import { FLEET_PROVIDER } from './fleet/fleet-provider';
import { VmmsFleetProvider } from './fleet/vmms-fleet.provider';
import { BookingClient } from './booking-client.service';
import { SchedulingController } from './dispatch/scheduling.controller';
import { JobOrderController } from './dispatch/job-order.controller';
import { AuditController, AuditProvider } from './audit';
import { InternalDispatchController } from './dispatch/internal-dispatch.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }), BmsAuthModule],
  controllers: [HealthController, DispatchController, SchedulingController, JobOrderController, FleetController, AuditController, InternalDispatchController],
  providers: [PrismaService, DispatchAuthGuard, DispatchService,
    { provide: FLEET_PROVIDER, useClass: VmmsFleetProvider },
    FleetService, BookingClient, AuditProvider],
})
export class AppModule {}
