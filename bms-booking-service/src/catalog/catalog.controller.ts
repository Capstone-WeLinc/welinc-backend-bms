import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { BookingAuthGuard, BmsRoles } from '../booking-auth.guard';
import { CatalogService } from './catalog.service';
import {
  CreatePrimaryServiceDto, UpdatePrimaryServiceDto,
  CreateServiceOfferingDto, UpdateServiceOfferingDto,
  CreateProtectiveMaterialDto, UpdateProtectiveMaterialDto,
} from './catalog.dto';

@Controller('bms/config')
@UseGuards(BookingAuthGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('booking-services')
  @BmsRoles('ADMIN', 'CUSTOMER_SUPPORT')
  bookingServices() { return this.catalog.bookingServices(); }

  @Post('booking-services')
  @BmsRoles('ADMIN')
  createBookingService(@Body() input: CreatePrimaryServiceDto) { return this.catalog.createBookingService(input); }

  @Patch('booking-services/:id')
  @BmsRoles('ADMIN')
  updateBookingService(@Param('id') id: string, @Body() input: UpdatePrimaryServiceDto) { return this.catalog.updateBookingService(id, input); }

  @Delete('booking-services/:id')
  @BmsRoles('ADMIN')
  removeBookingService(@Param('id') id: string) { return this.catalog.removeBookingService(id); }

  @Get('services-offered')
  @BmsRoles('ADMIN', 'CUSTOMER_SUPPORT')
  servicesOffered() { return this.catalog.servicesOffered(); }

  @Post('services-offered')
  @BmsRoles('ADMIN')
  createServiceOffered(@Body() input: CreateServiceOfferingDto) { return this.catalog.createServiceOffered(input); }

  @Patch('services-offered/:id')
  @BmsRoles('ADMIN')
  updateServiceOffered(@Param('id') id: string, @Body() input: UpdateServiceOfferingDto) { return this.catalog.updateServiceOffered(id, input); }

  @Delete('services-offered/:id')
  @BmsRoles('ADMIN')
  removeServiceOffered(@Param('id') id: string) { return this.catalog.removeServiceOffered(id); }

  @Get('protective-materials')
  @BmsRoles('ADMIN', 'OPERATIONS', 'CUSTOMER_SUPPORT')
  protectiveMaterials() { return this.catalog.protectiveMaterials(); }

  @Post('protective-materials')
  @BmsRoles('ADMIN')
  createProtectiveMaterial(@Body() input: CreateProtectiveMaterialDto) { return this.catalog.createProtectiveMaterial(input); }

  @Patch('protective-materials/:id')
  @BmsRoles('ADMIN')
  updateProtectiveMaterial(@Param('id') id: string, @Body() input: UpdateProtectiveMaterialDto) { return this.catalog.updateProtectiveMaterial(id, input); }

  @Delete('protective-materials/:id')
  @BmsRoles('ADMIN')
  removeProtectiveMaterial(@Param('id') id: string) { return this.catalog.removeProtectiveMaterial(id); }
}
