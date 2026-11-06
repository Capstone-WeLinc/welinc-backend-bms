import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { BmsRoles, DispatchAuthGuard } from '../dispatch-auth.guard';
import { FleetService } from './fleet.service';

@Controller('bms/config')
@UseGuards(DispatchAuthGuard)
export class FleetController {
  constructor(private readonly fleet: FleetService) {}

  @Get('garages') @BmsRoles('ADMIN', 'OPERATIONS') garages() { return this.fleet.garages(); }
  @Get('vehicles') @BmsRoles('ADMIN', 'OPERATIONS') vehicles() { return this.fleet.vehicles(); }
  @Get('vehicle-availability') @BmsRoles('ADMIN', 'OPERATIONS') vehicleAvailability() { return this.fleet.vehicleAvailability(); }
  @Get('vehicle-availability/:id/details') @BmsRoles('ADMIN', 'OPERATIONS') vehicleAvailabilityDetails(@Param('id') id: string) { return this.fleet.vehicleAvailabilityDetails(id); }
  // Keep these aliases under the existing gateway allow-list for older running gateways.
  @Get('vehicles/availability') @BmsRoles('ADMIN', 'OPERATIONS') vehicleAvailabilityCompat() { return this.fleet.vehicleAvailability(); }
  @Get('vehicles/availability/:id/details') @BmsRoles('ADMIN', 'OPERATIONS') vehicleAvailabilityDetailsCompat(@Param('id') id: string) { return this.fleet.vehicleAvailabilityDetails(id); }
  @Get('drivers') @BmsRoles('ADMIN', 'OPERATIONS') drivers() { return this.fleet.drivers(); }
  @Get('helpers') @BmsRoles('ADMIN', 'OPERATIONS') helpers() { return this.fleet.helpers(); }
  @Post('drivers') @BmsRoles('ADMIN') createDriver(@Body() body: Record<string, unknown>) { return this.fleet.createDriver(body); }
  @Patch('drivers/:id') @BmsRoles('ADMIN') updateDriver(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.fleet.updateDriver(id, body); }
  @Patch('drivers/:id/status') @BmsRoles('ADMIN') setDriverStatus(@Param('id') id: string, @Body() body: { status: string }) { return this.fleet.updateDriver(id, body); }
  @Delete('drivers/:id') @BmsRoles('ADMIN') removeDriver(@Param('id') id: string) { return this.fleet.removeDriver(id); }
  @Post('helpers') @BmsRoles('ADMIN') createHelper(@Body() body: Record<string, unknown>) { return this.fleet.createHelper(body); }
  @Patch('helpers/:id') @BmsRoles('ADMIN') updateHelper(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.fleet.updateHelper(id, body); }
  @Patch('helpers/:id/status') @BmsRoles('ADMIN') setHelperStatus(@Param('id') id: string, @Body() body: { status: string }) { return this.fleet.updateHelper(id, body); }
  @Delete('helpers/:id') @BmsRoles('ADMIN') removeHelper(@Param('id') id: string) { return this.fleet.removeHelper(id); }
}
