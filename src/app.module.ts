import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import SharedModule from './shared/shared.module';
import AuthModule from './auth/auth.module';
import { BookingModule } from './modules/bms/booking/booking.module';
import { SchedulingModule } from './modules/bms/scheduling/scheduling.module';
import { BmsConfigModule } from './modules/bms/config/config.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SharedModule,
    AuthModule,
    BookingModule,
    SchedulingModule,
    BmsConfigModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
