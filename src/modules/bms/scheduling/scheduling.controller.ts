import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { SchedulingService } from './scheduling.service';
import { AssignSchedulingDto } from './dto/assign-scheduling.dto';

@Controller('scheduling')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.OPERATIONS)
export class SchedulingController {
  constructor(private readonly schedulingService: SchedulingService) {}

  @Get()
  findAll() {
    return this.schedulingService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.schedulingService.findOne(id);
  }

  @Put(':id/assign')
  assign(@Param('id') id: string, @Body() dto: AssignSchedulingDto) {
    return this.schedulingService.assign(id, dto);
  }
}
