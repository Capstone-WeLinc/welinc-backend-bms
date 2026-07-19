import { Module } from '@nestjs/common';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import SharedModule from '../../../shared/shared.module';

@Module({
  imports: [SharedModule],
  controllers: [BookingController],
  providers: [BookingService],
})
export class BookingModule {}
