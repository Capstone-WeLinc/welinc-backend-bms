import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from './prisma.service';
import { DispatchAuthGuard } from './dispatch-auth.guard';
import { HealthController } from './health.controller';
import { DispatchController } from './dispatch/dispatch.controller';
import { DispatchService } from './dispatch/dispatch.service';
import { FleetController } from './fleet/fleet.controller';
import { FleetService } from './fleet/fleet.service';
import { FLEET_PROVIDER } from './fleet/fleet-provider';
import { LocalFleetProvider } from './fleet/local-fleet.provider';
import { BookingClient } from './booking-client.service';
import { SchedulingController } from './dispatch/scheduling.controller';
import { JobOrderController } from './dispatch/job-order.controller';
import { AuditController, AuditProvider } from './audit';
import { InternalDispatchController } from './dispatch/internal-dispatch.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), JwtModule.register({})],
  controllers: [HealthController, DispatchController, SchedulingController, JobOrderController, FleetController, AuditController, InternalDispatchController],
  providers: [PrismaService, DispatchAuthGuard, DispatchService,
    { provide: FLEET_PROVIDER, useFactory: () => new LocalFleetProvider() },
    FleetService, BookingClient, AuditProvider],
})
export class AppModule {}
