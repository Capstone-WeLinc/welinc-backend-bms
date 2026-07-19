import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { BmsConfigService } from './config.service';

@Controller('bms')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.CUSTOMER_SUPPORT, UserRole.OPERATIONS)
export class BmsConfigController {
  constructor(private readonly service: BmsConfigService) {}

  @Get('config/garages')
  listGarages() {
    return this.service.listGarages();
  }

  @Get('config/vehicles')
  listVehicles() {
    return this.service.listVehicles();
  }

  @Get('config/drivers')
  listDrivers() {
    return this.service.listDrivers();
  }
}
