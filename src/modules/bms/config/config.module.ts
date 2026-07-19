import { Module } from '@nestjs/common';
import SharedModule from '../../../shared/shared.module';
import { BmsConfigService } from './config.service';
import { BmsConfigController } from './config.controller';

@Module({
  imports: [SharedModule],
  providers: [BmsConfigService],
  controllers: [BmsConfigController],
})
export class BmsConfigModule {}
