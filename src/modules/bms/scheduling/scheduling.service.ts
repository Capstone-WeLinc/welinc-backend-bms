import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Booking } from '@prisma/client';
import { PrismaService } from '../../../shared/prisma.service';
import { AssignSchedulingDto } from './dto/assign-scheduling.dto';
import { SAMPLE_DRIVERS } from '../sample-data';

@Injectable()
export class SchedulingService {
  constructor(private readonly prisma: PrismaService) {}

  private formatBooking(booking: any) {
    return {
      ...booking,
      amount: booking.amount !== null ? Number(booking.amount) : null,
    };
  }

  findAll() {
    return this.prisma.booking
      .findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: ({ vehicle: true, driver: true } as any),
      })
      .then((bookings) => bookings.map((b) => this.formatBooking(b)));
  }

  async findOne(id: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id, deletedAt: null },
      include: ({ vehicle: true, driver: true } as any),
    });
    if (!booking) throw new NotFoundException(`Booking with id ${id} not found`);
    return this.formatBooking(booking);
  }

  async assign(id: string, dto: AssignSchedulingDto) {
    await this.findOne(id); // throw if not exists

    if (dto.vehicleId) {
      const vehicle = await this.prisma.vehicle.findFirst({
        where: { id: dto.vehicleId, isActive: true, deletedAt: null },
      });
      if (!vehicle) {
        throw new BadRequestException(`Vehicle with id ${dto.vehicleId} not found`);
      }
      if (vehicle.status !== 'AVAILABLE') {
        throw new BadRequestException(`Vehicle ${vehicle.plateNumber} is not available (${vehicle.status})`);
      }
    }

    // Handle driver IDs that come from BMS SAMPLE_DRIVERS (non-UUID ids like 'd003')
    function isUuid(val: string) {
      return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(val);
    }

    if (dto.driverId && !isUuid(dto.driverId)) {
      // attempt to resolve sample driver -> real DB driver by license or name; create if missing
      const sample = SAMPLE_DRIVERS.find(s => s.id === dto.driverId || s.empId === dto.driverId);
      if (sample) {
        // prefer licenseNo lookup
        const license = sample.licenseNo || sample.empId || '';
        let dbDriver: any = null;
        if (license) {
          dbDriver = await this.prisma.driver.findFirst({
            where: { licenseNumber: license, deletedAt: null },
          });
        }
        if (!dbDriver) {
          dbDriver = await this.prisma.driver.findFirst({
            where: { name: sample.fullName, deletedAt: null },
          });
        }
        if (!dbDriver) {
          dbDriver = await this.prisma.driver.create({
            data: {
              name: sample.fullName,
              licenseNumber: sample.licenseNo || (sample.empId || `EMP-${Math.random().toString(36).slice(2,8)}`),
              isVerified: !!sample.isVerified,
              isActive: true,
            },
          });
        }
        if (dbDriver) dto.driverId = dbDriver.id;
      }
    }

    const data: any = {
      time: dto.time !== undefined ? dto.time : undefined,
      garage: dto.garage !== undefined ? dto.garage : undefined,
      deliveryType: dto.deliveryType !== undefined ? dto.deliveryType : undefined,
      vehicleId: dto.vehicleId !== undefined ? dto.vehicleId : undefined,
      driverId: dto.driverId !== undefined ? dto.driverId : undefined,
      helperIds: dto.helperIds !== undefined ? dto.helperIds : undefined,
      status: 'Scheduled',
    };

    const updated = await this.prisma.booking.update({
      where: { id },
      data,
      include: ({ vehicle: true, driver: true } as any),
    });

    return this.formatBooking(updated);
  }
}
