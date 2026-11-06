import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from './prisma.service';
import { BookingAuthGuard } from './booking-auth.guard';
import { HealthController } from './health.controller';
import { BookingController } from './booking/booking.controller';
import { BookingService } from './booking/booking.service';
import { CustomerNotificationService } from './booking/customer-notification.service';
import { InternalBookingController } from './booking/internal-booking.controller';
import { PublicTrackingController } from './booking/public-tracking.controller';
import { BookingRouteService } from './booking/booking-route.service';
import { ApprovalsService } from './booking/approvals.service';
import { ApprovalsController } from './booking/approvals.controller';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { WelincWebhookController } from './webhook/welinc-webhook.controller';
import { WelincWebhookService } from './webhook/welinc-webhook.service';
import { AuditController, AuditProvider } from './audit';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), JwtModule.register({})],
  controllers: [HealthController, BookingController, ApprovalsController, InternalBookingController, PublicTrackingController, CatalogController, WelincWebhookController, AuditController],
  providers: [PrismaService, BookingAuthGuard, BookingService, ApprovalsService, CustomerNotificationService, BookingRouteService, CatalogService, WelincWebhookService, AuditProvider],
})
export class AppModule {}
