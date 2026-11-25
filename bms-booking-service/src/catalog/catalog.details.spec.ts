import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Prisma } from '@prisma/client';
import { CatalogService } from './catalog.service';
import { CreateServiceOfferingDto, UpdateServiceOfferingDto } from './catalog.dto';

/** Spec bms/0013: inclusions, payment options and exclusions on additional services. */
describe('Additional service details', () => {
  const ID = '11111111-1111-4111-8111-111111111111';
  let saved: Record<string, unknown> | undefined;
  let existing: Record<string, unknown> | null;
  const row = (data: Record<string, unknown>) => ({ id: ID, price: new Prisma.Decimal(990), cashCharge: new Prisma.Decimal(0), ...data, ...(typeof data.cashCharge === 'number' && { cashCharge: new Prisma.Decimal(data.cashCharge) }) });
  const prisma: any = {
    serviceOffering: {
      findUnique: async () => existing,
      create: async ({ data }: any) => { saved = data; return row(data); },
      update: async ({ data }: any) => { saved = data; return row({ ...existing, ...data }); },
    },
  };
  const service = new CatalogService(prisma);

  beforeEach(() => { saved = undefined; existing = null; });

  it('saves the three lists, trimmed and without blank lines', async () => {
    await service.createServiceOffered({
      name: 'Motorized Helper', price: 990,
      inclusions: [' 1 motorized staff member ', '', 'Fuel'],
      paymentOptions: ['Cash upon delivery'],
      exclusions: ['  '],
    });
    expect(saved).toMatchObject({ inclusions: ['1 motorized staff member', 'Fuel'], paymentOptions: ['Cash upon delivery'], exclusions: [] });
  });

  it('a new service without details gets empty lists', async () => {
    await service.createServiceOffered({ name: 'Basic Packing Service', price: 3450 });
    expect(saved).toMatchObject({ inclusions: [], paymentOptions: [], exclusions: [] });
  });

  it('re-adding a removed service replaces its old details', async () => {
    existing = { id: ID, name: 'Motorized Helper', isActive: false, inclusions: ['Old'], paymentOptions: ['Old'], exclusions: ['Old'] };
    await service.createServiceOffered({ name: 'Motorized Helper', price: 990, inclusions: ['Fuel'] });
    expect(saved).toMatchObject({ inclusions: ['Fuel'], paymentOptions: [], exclusions: [] });
  });

  it('an update changes only the lists that were sent', async () => {
    existing = { id: ID, name: 'Motorized Helper', isActive: true };
    await service.updateServiceOffered(ID, { exclusions: ['Condominium and subdivision entry and exit fees'] });
    expect(saved).toEqual({ exclusions: ['Condominium and subdivision entry and exit fees'] });
  });

  it('saves a cash charge as a number, 0 when not sent, and refuses a negative one', async () => {
    const created = await service.createServiceOffered({ name: 'Basic Packing Service', price: 3450, cashCharge: 500 });
    expect(saved).toMatchObject({ cashCharge: 500 });
    expect(created.cashCharge).toBe(500);
    await service.createServiceOffered({ name: 'Motorized Helper', price: 990 });
    expect(saved).toMatchObject({ cashCharge: 0 });
    existing = { id: ID, name: 'Basic Packing Service', isActive: true };
    await service.updateServiceOffered(ID, { price: 3500 });
    expect(saved).not.toHaveProperty('cashCharge');
    expect(validateSync(plainToInstance(UpdateServiceOfferingDto, { cashCharge: -1 }) as object)).not.toHaveLength(0);
  });

  it('refuses more than 20 lines, or a line over 200 characters', () => {
    const errors = (dto: object, cls: any) => validateSync(plainToInstance(cls, dto) as object);
    expect(errors({ name: 'x', price: 1, inclusions: Array(21).fill('a') }, CreateServiceOfferingDto)).not.toHaveLength(0);
    expect(errors({ paymentOptions: ['a'.repeat(201)] }, UpdateServiceOfferingDto)).not.toHaveLength(0);
    expect(errors({ exclusions: 'not a list' }, UpdateServiceOfferingDto)).not.toHaveLength(0);
    expect(errors({ name: 'x', price: 1, inclusions: ['Fuel'], paymentOptions: [], exclusions: [] }, CreateServiceOfferingDto)).toHaveLength(0);
  });
});
