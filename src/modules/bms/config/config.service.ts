import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma.service';
import { SAMPLE_DRIVERS } from '../sample-data';

@Injectable()
export class BmsConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async listGarages() {
    const garages = await this.prisma.garage.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return garages.map((g) => ({ id: g.id, name: g.name }));
  }

  async listVehicles() {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, plateNumber: true, model: true, status: true },
      orderBy: { plateNumber: 'asc' },
    });
    return vehicles.map((v) => ({
      id: v.id,
      plateNumber: v.plateNumber,
      model: v.model,
      status: v.status,
      requiredHelpers: 1,
    }));
  }

  async listDrivers() {
    return SAMPLE_DRIVERS.map((d) => ({
      id: d.id,
      empId: d.empId,
      fullName: d.fullName,
      initials: d.initials || (d.fullName || '').split(' ').map((p: string) => p[0]).join('').toUpperCase(),
      status: d.status || 'Available',
      licenseNo: d.licenseNo || '',
      licenseType: d.licenseType || 'Professional',
      licenseExpiry: d.licenseExpiry || '',
      totalTrips: d.totalTrips || 0,
      joinDate: d.joinDate || '',
      contact: d.contact || '',
      email: d.email || '',
      address: d.address || '',
      emergencyName: d.emergencyName || '',
      emergencyContact: d.emergencyContact || '',
      vehicleId: d.vehicleId || null,
      isVerified: !!d.isVerified,
    }));
  }
}
