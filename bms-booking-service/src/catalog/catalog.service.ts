import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  CreatePrimaryServiceDto, UpdatePrimaryServiceDto,
  CreateServiceOfferingDto, UpdateServiceOfferingDto,
  CreateProtectiveMaterialDto, UpdateProtectiveMaterialDto,
} from './catalog.dto';

function name(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new BadRequestException('Name is required');
  return trimmed;
}

function requireUuid(id: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new BadRequestException('Invalid catalog ID');
  }
}

function optionalText(value: string | undefined): string | null | undefined {
  return value === undefined ? undefined : value.trim() || null;
}

/** A list of detail lines, trimmed, with blank lines dropped (spec bms/0013). */
function detailList(value: string[] | undefined): string[] | undefined {
  return value === undefined ? undefined : value.map((line) => line.trim()).filter(Boolean);
}

/** Only the detail lists that were sent, so a partial update leaves the others alone. */
function details(input: { inclusions?: string[]; paymentOptions?: string[]; exclusions?: string[] }) {
  const inclusions = detailList(input.inclusions);
  const paymentOptions = detailList(input.paymentOptions);
  const exclusions = detailList(input.exclusions);
  return {
    ...(inclusions !== undefined && { inclusions }),
    ...(paymentOptions !== undefined && { paymentOptions }),
    ...(exclusions !== undefined && { exclusions }),
  };
}

function uniqueName(error: unknown, label: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new BadRequestException(`A ${label} with this name already exists`);
  }
  throw error;
}

function withPrice<T extends { price: Prisma.Decimal }>(row: T): Omit<T, 'price'> & { price: number } {
  return { ...row, price: Number(row.price) };
}

/** An additional service row with its money fields as numbers. */
function offering<T extends { price: Prisma.Decimal; cashCharge: Prisma.Decimal }>(row: T) {
  return { ...withPrice(row), cashCharge: Number(row.cashCharge) };
}

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  bookingServices() {
    return this.prisma.bookingServiceCatalog.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  }

  async createBookingService(input: CreatePrimaryServiceDto) {
    const itemName = name(input.name);
    const data = { name: itemName, description: optionalText(input.description) ?? null, isActive: true };
    const existing = await this.prisma.bookingServiceCatalog.findUnique({ where: { name: itemName } });
    if (existing?.isActive) throw new BadRequestException('A service with this name already exists');
    try {
      return existing
        ? await this.prisma.bookingServiceCatalog.update({ where: { id: existing.id }, data })
        : await this.prisma.bookingServiceCatalog.create({ data });
    } catch (error) { return uniqueName(error, 'service'); }
  }

  async updateBookingService(id: string, input: UpdatePrimaryServiceDto) {
    requireUuid(id);
    const existing = await this.prisma.bookingServiceCatalog.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Service not found');
    try {
      return await this.prisma.bookingServiceCatalog.update({ where: { id }, data: {
        ...(input.name !== undefined && { name: name(input.name) }),
        ...(input.description !== undefined && { description: optionalText(input.description) }),
      } });
    } catch (error) { return uniqueName(error, 'service'); }
  }

  async removeBookingService(id: string) {
    requireUuid(id);
    const existing = await this.prisma.bookingServiceCatalog.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Service not found');
    return this.prisma.bookingServiceCatalog.update({ where: { id }, data: { isActive: false } });
  }

  async servicesOffered() {
    const rows = await this.prisma.serviceOffering.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
    return rows.map(offering);
  }

  async createServiceOffered(input: CreateServiceOfferingDto) {
    const itemName = name(input.name);
    const data = {
      name: itemName, description: optionalText(input.description) ?? null, duration: optionalText(input.duration) ?? null,
      price: input.price, isActive: true,
      // Re-adding a removed service replaces its old details, like its other fields.
      inclusions: [], paymentOptions: [], exclusions: [], ...details(input),
      cashCharge: input.cashCharge ?? 0,
    };
    const existing = await this.prisma.serviceOffering.findUnique({ where: { name: itemName } });
    if (existing?.isActive) throw new BadRequestException('A service with this name already exists');
    try {
      const row = existing
        ? await this.prisma.serviceOffering.update({ where: { id: existing.id }, data })
        : await this.prisma.serviceOffering.create({ data });
      return offering(row);
    } catch (error) { return uniqueName(error, 'service'); }
  }

  async updateServiceOffered(id: string, input: UpdateServiceOfferingDto) {
    requireUuid(id);
    const existing = await this.prisma.serviceOffering.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Service not found');
    try {
      const row = await this.prisma.serviceOffering.update({ where: { id }, data: {
        ...(input.name !== undefined && { name: name(input.name) }),
        ...(input.description !== undefined && { description: optionalText(input.description) }),
        ...(input.duration !== undefined && { duration: optionalText(input.duration) }),
        ...(input.price !== undefined && { price: input.price }),
        ...details(input),
        ...(input.cashCharge !== undefined && { cashCharge: input.cashCharge }),
      } });
      return offering(row);
    } catch (error) { return uniqueName(error, 'service'); }
  }

  async removeServiceOffered(id: string) {
    requireUuid(id);
    const existing = await this.prisma.serviceOffering.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Service not found');
    const row = await this.prisma.serviceOffering.update({ where: { id }, data: { isActive: false } });
    return offering(row);
  }

  async protectiveMaterials() {
    const rows = await this.prisma.protectiveMaterial.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
    return rows.map(withPrice);
  }

  async createProtectiveMaterial(input: CreateProtectiveMaterialDto) {
    const itemName = name(input.name);
    const data = { name: itemName, description: optionalText(input.description) ?? null, price: input.price, isActive: true };
    const existing = await this.prisma.protectiveMaterial.findUnique({ where: { name: itemName } });
    if (existing?.isActive) throw new BadRequestException('A material with this name already exists');
    try {
      const row = existing
        ? await this.prisma.protectiveMaterial.update({ where: { id: existing.id }, data })
        : await this.prisma.protectiveMaterial.create({ data });
      return withPrice(row);
    } catch (error) { return uniqueName(error, 'material'); }
  }

  async updateProtectiveMaterial(id: string, input: UpdateProtectiveMaterialDto) {
    requireUuid(id);
    const existing = await this.prisma.protectiveMaterial.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Material not found');
    try {
      const row = await this.prisma.protectiveMaterial.update({ where: { id }, data: {
        ...(input.name !== undefined && { name: name(input.name) }),
        ...(input.description !== undefined && { description: optionalText(input.description) }),
        ...(input.price !== undefined && { price: input.price }),
      } });
      return withPrice(row);
    } catch (error) { return uniqueName(error, 'material'); }
  }

  async removeProtectiveMaterial(id: string) {
    requireUuid(id);
    const existing = await this.prisma.protectiveMaterial.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Material not found');
    const row = await this.prisma.protectiveMaterial.update({ where: { id }, data: { isActive: false } });
    return withPrice(row);
  }
}
