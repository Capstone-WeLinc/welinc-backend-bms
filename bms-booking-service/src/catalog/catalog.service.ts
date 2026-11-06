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

function uniqueName(error: unknown, label: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new BadRequestException(`A ${label} with this name already exists`);
  }
  throw error;
}

function withPrice<T extends { price: Prisma.Decimal }>(row: T): Omit<T, 'price'> & { price: number } {
  return { ...row, price: Number(row.price) };
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
    return rows.map(withPrice);
  }

  async createServiceOffered(input: CreateServiceOfferingDto) {
    const itemName = name(input.name);
    const data = {
      name: itemName, description: optionalText(input.description) ?? null, duration: optionalText(input.duration) ?? null,
      price: input.price, isActive: true,
    };
    const existing = await this.prisma.serviceOffering.findUnique({ where: { name: itemName } });
    if (existing?.isActive) throw new BadRequestException('A service with this name already exists');
    try {
      const row = existing
        ? await this.prisma.serviceOffering.update({ where: { id: existing.id }, data })
        : await this.prisma.serviceOffering.create({ data });
      return withPrice(row);
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
      } });
      return withPrice(row);
    } catch (error) { return uniqueName(error, 'service'); }
  }

  async removeServiceOffered(id: string) {
    requireUuid(id);
    const existing = await this.prisma.serviceOffering.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Service not found');
    const row = await this.prisma.serviceOffering.update({ where: { id }, data: { isActive: false } });
    return withPrice(row);
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
