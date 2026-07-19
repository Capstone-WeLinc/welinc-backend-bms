import { Module } from '@nestjs/common';
import { SchedulingService } from './scheduling.service';
import { SchedulingController } from './scheduling.controller';
import SharedModule from '../../../shared/shared.module';

@Module({
  imports: [SharedModule],
  providers: [SchedulingService],
  controllers: [SchedulingController],
})
export class SchedulingModule {}
