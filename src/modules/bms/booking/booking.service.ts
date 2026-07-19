import { Injectable, NotFoundException } from '@nestjs/common';
import { Booking, Prisma } from '@prisma/client';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { PrismaService } from '../../../shared/prisma.service';

@Injectable()
export class BookingService {
  constructor(private readonly prisma: PrismaService) {}

  private bookingPrefixFor(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `WL-${year}${month}${day}-`;
  }

  private async nextBookingId() {
    const prefix = this.bookingPrefixFor(new Date());
    const rows = await this.prisma.booking.findMany({
      where: { bookingId: { startsWith: prefix } },
      select: { bookingId: true },
    });
    const used = new Set<number>();
    const pattern = new RegExp(`^${prefix}(\\d{6})$`);

    rows.forEach(({ bookingId }) => {
      const match = bookingId.match(pattern);
      if (match) used.add(Number(match[1]));
    });

    for (let suffix = 1; suffix <= 999999; suffix += 1) {
      if (!used.has(suffix)) {
        return `${prefix}${String(suffix).padStart(6, '0')}`;
      }
    }

    throw new Error(`Booking ID sequence exhausted for ${prefix}`);
  }

  private isBookingIdConflict(error: unknown) {
    const prismaError = error as { code?: string };
    return prismaError.code === 'P2002';
  }

  private normalizeStatus(status: string) {
    if (status === 'Confirmed') return 'Scheduled';
    if (status === 'Discrepancy' || status === 'For Correction')
      return 'For Plotting';
    return ['For Plotting', 'Scheduled', 'Rescheduled', 'Completed', 'Cancelled'].includes(status)
      ? status
      : 'For Plotting';
  }

  private formatBooking(booking: Booking) {
    return {
      ...booking,
      address: booking.address ?? booking.deliveryAddress ?? booking.pickupAddress,
      amount: booking.amount !== null ? Number(booking.amount) : null,
      moveDate: booking.date,
      preferredTime: booking.time,
      additionalServicesAvailed: Array.isArray(booking.additionalServicesAvailed)
        ? booking.additionalServicesAvailed
        : [],
    };
  }

  findAll() {
    return this.prisma.booking
      .findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
      })
      .then((bookings) => bookings.map((b) => this.formatBooking(b)));
  }

  async findOne(id: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id, deletedAt: null },
    });
    if (!booking)
      throw new NotFoundException(`Booking with id ${id} not found`);
    return this.formatBooking(booking);
  }

  async create(dto: CreateBookingDto) {
    let created: Booking | null = null;

    for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
      const bookingId = await this.nextBookingId();
      try {
        created = await this.prisma.booking.create({
          data: {
            bookingId,
            client: dto.client,
            service: dto.service,
            serviceType: dto.serviceType ?? null,
            deliveryCategory: dto.deliveryCategory ?? null,
            date: dto.date,
            address: dto.address ?? dto.deliveryAddress ?? null,
            pickupAddress: dto.pickupAddress ?? null,
            deliveryAddress: dto.deliveryAddress ?? null,
            amount: dto.amount ? dto.amount : null,
            totalAmount: dto.totalAmount ?? null,
            paymentStatus: dto.paymentStatus ?? 'Pending',
            paymentMethod: dto.paymentMethod ?? null,
            fullName: dto.fullName ?? dto.client,
            contact: dto.contact ?? null,
            email: dto.email ?? null,
            deliveryLocation: dto.deliveryLocation ?? null,
            estimatedItems: dto.estimatedItems ?? null,
            itemDetails: dto.itemDetails ?? null,
            specialInstructions: dto.specialInstructions ?? null,
            notes: dto.notes ?? null,
            status: this.normalizeStatus(dto.status ?? 'For Plotting'),
            servicesAvailed: dto.servicesAvailed ?? [],
            protectiveMaterials: dto.protectiveMaterials ?? [],
            additionalServicesAvailed:
              (dto.additionalServicesAvailed as Prisma.InputJsonValue | undefined) ??
              [],
            hasInsurance: dto.hasInsurance ?? false,
            permitRequired: dto.permitRequired ?? false,
            time: dto.preferredTime ?? null,
          },
        });
      } catch (error) {
        if (!this.isBookingIdConflict(error)) throw error;
      }
    }

    if (!created) {
      throw new Error('Unable to allocate a booking ID.');
    }

    return this.formatBooking(created);
  }

  async update(id: string, dto: UpdateBookingDto) {
    await this.findOne(id); // will throw if not exists
    const data: Prisma.BookingUpdateInput = {};
    if (dto.status !== undefined) data.status = this.normalizeStatus(dto.status);
    if (dto.date !== undefined) data.date = dto.date;
    if (dto.moveDate !== undefined) data.date = dto.moveDate;
    if (dto.discrepancyNote !== undefined)
      data.discrepancyNote = dto.discrepancyNote;
    if (dto.flagged !== undefined) data.flagged = dto.flagged;
    if (dto.permitRequired !== undefined) data.permitRequired = dto.permitRequired;

    if (data.status === 'Rescheduled') {
      data.vehicle = { disconnect: true };
      data.driver = { disconnect: true };
      data.helperIds = [];
      data.garage = null;
      data.deliveryType = null;
    }

    const updated = await this.prisma.booking.update({ where: { id }, data });
    return this.formatBooking(updated);
  }

  async remove(id: string) {
    await this.findOne(id);
    const deleted = await this.prisma.booking.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return this.formatBooking(deleted);
  }
}
