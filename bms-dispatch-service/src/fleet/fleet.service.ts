import { DirectoryClient } from '../auth/directory.client';
import { permanentCrew } from './vmms-fleet.provider';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { BookingClient } from '../booking-client.service';
import { FLEET_PROVIDER, type FleetProvider } from './fleet-provider';

const STATUS = ['Available', 'On Duty', 'Off Duty', 'On Leave'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const manilaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

function parseCapacityKg(value: unknown): number | null {
  const digits = String(value ?? '').replace(/[^\d]/g, '');
  return Number(digits) || null;
}

function vehicleDimensions(type?: string | null) {
  if (type === '6W 14ft. with Lifter') return '14 x 7 x 6 FT.';
  if (type === '10ft. Closed Van') return '10 x 6 x 6 FT.';
  if (type === '4W L300 FB Van') return `4W - 7'5" x 4 x 4 FT.`;
  return null;
}

function dateText(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text;
}

function formatRoute(deliveryLocation: unknown, pickupAddress: unknown, deliveryAddress: unknown) {
  const route = String(deliveryLocation ?? '').trim();
  if (route) return route;
  const pickup = String(pickupAddress ?? '').trim();
  const delivery = String(deliveryAddress ?? '').trim();
  return pickup || delivery ? `${pickup || 'Pickup not recorded'} → ${delivery || 'Delivery not recorded'}` : 'Route not recorded';
}

function required(value: unknown, name: string, max: number) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new BadRequestException(`Invalid ${name}`);
  return text;
}

function optionalDate(value: unknown, name: string) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  const text = String(value);
  const date = new Date(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new BadRequestException(`Invalid ${name}`);
  }
  return date;
}

@Injectable()
export class FleetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly directory: DirectoryClient,
    private readonly bookings: BookingClient,
    @Inject(FLEET_PROVIDER) private readonly provider: FleetProvider,
  ) {}

  garages() { return this.provider.garages(); }

  async vehicles() {
    const [rows, activeAssignments] = await Promise.all([
      this.provider.vehicles(),
      this.prisma.dispatchAssignment.findMany({
        where: { state: { in: ['PENDING', 'CONFIRMED', 'RELEASING'] }, serviceDate: manilaToday() }, select: { vehicleId: true },
      }),
    ]);
    const assigned = new Set(activeAssignments.map((item) => item.vehicleId));
    return rows.map((vehicle) => ({ ...vehicle, isAssigned: assigned.has(String(vehicle.id)) }));
  }

  /** View-only inventory from VMMS, enriched with BMS assignment details. */
  async vehicleAvailability() {
    const [vehicles, assignments, bookings, drivers, helpers] = await Promise.all([
      this.vehicles(),
      this.prisma.dispatchAssignment.findMany({
        where: { state: 'CONFIRMED', vehicleId: { not: null } },
        orderBy: [{ serviceDate: 'asc' }, { dispatchTime: 'asc' }],
      }),
      this.bookings.list(),
      this.provider.drivers(),
      this.helpers(),
    ]);
    const bookingById = new Map(bookings.map((booking) => [booking.id, booking]));
    const jobOrders = await this.prisma.dispatchJobOrder.findMany({
      where: { bookingUuid: { in: assignments.map((item) => item.bookingUuid) } },
      select: { bookingUuid: true, jobOrderNo: true },
    });
    const jobOrderByBooking = new Map(jobOrders.map((item) => [item.bookingUuid, item.jobOrderNo]));
    const driverById = new Map(drivers.map((item) => [item.id, item]));
    const helperById = new Map(helpers.map((item) => [item.id, item]));
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

    const realRows = vehicles.map((vehicle) => {
      const vehicleAssignments = assignments.filter((item) => item.vehicleId === vehicle.id);
      const primary = vehicleAssignments.find((item) => item.serviceDate >= today) ?? vehicleAssignments.at(-1);
      const currentBooking = primary ? bookingById.get(primary.bookingUuid) : undefined;
      const driver = primary?.driverId ? driverById.get(primary.driverId) : undefined;
      const assignedDriver = driver ?? (vehicle.driverId ? driverById.get(vehicle.driverId) : undefined);
      const assignedHelpers = primary ? primary.helperIds.map((id) => helperById.get(id)).filter(Boolean) : [];
      const upcomingSchedule = vehicleAssignments
        .filter((item) => item.serviceDate >= today && item.bookingUuid !== primary?.bookingUuid)
        .map((item) => {
          const booking = bookingById.get(item.bookingUuid);
          return {
            date: item.serviceDate,
            time: item.dispatchTime ?? booking?.preferredTime ?? '',
            bookingNumber: booking?.bookingNo ?? booking?.bookingId ?? '—',
            locationCode: ((booking as any)?.deliveryLocation ?? '').split(/[—–-]/, 1)[0].trim() || '—',
          };
        });
      return {
        ...vehicle,
        truckTypeId: vehicle.truckTypeId || vehicle.type || '',
        capacityKg: parseCapacityKg(vehicle.capacity),
        dimensions: vehicleDimensions(vehicle.truckTypeId || vehicle.type),
        requiredHelpersMin: vehicle.requiredHelpers,
        requiredHelpersMax: vehicle.requiredHelpers,
        driver: assignedDriver ? { id: assignedDriver.id, name: assignedDriver.fullName, initials: assignedDriver.initials } : null,
        helpers: assignedHelpers.map((helper) => ({ id: helper!.id, name: helper!.fullName, initials: helper!.initials })),
        currentAssignment: primary && currentBooking ? {
          bookingNumber: currentBooking.bookingNo || currentBooking.bookingId,
          jobOrderNumber: jobOrderByBooking.get(primary.bookingUuid) ?? null,
          service: currentBooking.service,
          date: primary.serviceDate,
          startTime: primary.dispatchTime,
          endTime: null,
          route: formatRoute((currentBooking as any).deliveryLocation, currentBooking.pickupAddress, currentBooking.deliveryAddress),
        } : null,
        upcomingSchedule,
        statusDetails: vehicle.statusReason || vehicle.statusSince || vehicle.expectedBackAt || vehicle.statusRemarks ? {
          reason: vehicle.statusReason ?? null,
          since: dateText(vehicle.statusSince),
          expectedBack: dateText(vehicle.expectedBackAt),
          remarks: vehicle.statusRemarks ?? null,
        } : null,
      };
    });

    return realRows;
  }

  async vehicleAvailabilityDetails(id: string) {
    const vehicle = (await this.vehicleAvailability()).find((item) => item.id === id);
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    return vehicle;
  }

  async drivers() {
    const [rows, activeAssignments] = await Promise.all([
      this.provider.drivers(),
      this.prisma.dispatchAssignment.findMany({
        where: { state: { in: ['PENDING', 'CONFIRMED', 'RELEASING'] }, serviceDate: manilaToday() }, select: { driverId: true },
      }),
    ]);
    const assigned = new Set(activeAssignments.map((item) => item.driverId));
    return rows.map((driver) => ({
      ...driver, status: assigned.has(String(driver.id)) ? 'On Duty' : driver.status || 'Available',
    }));
  }

  async helpers() {
    const [rows, activeAssignments] = await Promise.all([
      this.prisma.helper.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.dispatchAssignment.findMany({ where: { state: { in: ['PENDING', 'CONFIRMED', 'RELEASING'] }, serviceDate: manilaToday() }, select: { helperIds: true } }),
    ]);
    const assigned = new Set(activeAssignments.flatMap((item) => item.helperIds));
    const people = await this.directory.lookup(rows.flatMap(h=>h.userId?[h.userId]:[]));
    return rows.filter(h=>!h.userId || permanentCrew(people.get(h.userId),'HELPER')).map((helper) => ({
      id: helper.id, empId: helper.empId, fullName: helper.name, initials: helper.initials,
      contact: helper.contact ?? '', email: helper.email ?? '', status: assigned.has(helper.id) ? 'On Duty' : helper.crewStatus,
      totalTrips: helper.totalTrips, joinDate: helper.joinDate?.toISOString().slice(0, 10) ?? '',
      emergencyName: helper.emergencyName ?? '', emergencyContact: helper.emergencyContact ?? '',
      updatedAt: helper.updatedAt?.toISOString() ?? null,
    }));
  }

  async checkAssignment(vehicleId: string, driverId: string, helperIds: string[]) {
    if (!uuid.test(vehicleId) || !uuid.test(driverId) || helperIds.some((id) => !uuid.test(id))) {
      throw new BadRequestException('Assignment requires persisted fleet and crew IDs');
    }
    const { vehicle, driver } = await this.provider.assignmentResources(vehicleId, driverId);
    if (!vehicle || vehicle.status !== 'AVAILABLE') throw new ConflictException({code:'VEHICLE_UNAVAILABLE',message:'Vehicle is unavailable'});
    if (!driver || !['Available', 'On Duty'].includes(driver.status ?? 'Available')) {
      throw new BadRequestException('Driver is unavailable');
    }
    if (new Set(helperIds).size !== helperIds.length || helperIds.length < vehicle.requiredHelpers) {
      throw new BadRequestException('Required helpers are missing or duplicated');
    }
    const helpers = await this.prisma.helper.findMany({ where: { id: { in: helperIds }, isActive: true } });
    const people = await this.directory.lookup(helpers.flatMap(h=>h.userId?[h.userId]:[]));
    if (helpers.length !== helperIds.length || helpers.some(h=>h.userId && !permanentCrew(people.get(h.userId),'HELPER'))) throw new BadRequestException('Helper is unavailable');
    return { plateNumber: vehicle.plateNumber };
  }

  async createHelper(body: Record<string, unknown>) {
    const name = required(body.fullName, 'fullName', 100);
    const [{ value }] = await this.prisma.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('dispatch_helper_emp_no_seq') AS value`;
    const helper = await this.prisma.helper.create({ data: {
      empId: `HLP-${String(value).padStart(3, '0')}`, name,
      initials: name.split(/\s+/).slice(0, 2).map((part) => part[0].toUpperCase()).join(''),
      contact: body.contact ? required(body.contact, 'contact', 80) : null,
      email: body.email ? required(body.email, 'email', 160) : null,
      crewStatus: STATUS.includes(String(body.status)) ? String(body.status) : 'Available',
      joinDate: optionalDate(body.joinDate, 'joinDate'),
      emergencyName: body.emergencyName ? required(body.emergencyName, 'emergencyName', 160) : null,
      emergencyContact: body.emergencyContact ? required(body.emergencyContact, 'emergencyContact', 80) : null,
    } });
    return (await this.helpers()).find((item) => item.id === helper.id);
  }

  async updateHelper(id: string, body: Record<string, unknown>) {
    const helper = await this.prisma.helper.findUnique({ where: { id } });
    if (!helper?.isActive) throw new NotFoundException('Helper not found');
    await this.prisma.helper.update({ where: { id }, data: {
      ...(body.fullName !== undefined && { name: required(body.fullName, 'fullName', 100) }),
      ...(body.contact !== undefined && { contact: body.contact ? required(body.contact, 'contact', 80) : null }),
      ...(body.email !== undefined && { email: body.email ? required(body.email, 'email', 160) : null }),
      ...(body.status !== undefined && { crewStatus: required(body.status, 'status', 40) }),
      ...(body.joinDate !== undefined && { joinDate: optionalDate(body.joinDate, 'joinDate') }),
      ...(body.emergencyName !== undefined && { emergencyName: body.emergencyName ? required(body.emergencyName, 'emergencyName', 160) : null }),
      ...(body.emergencyContact !== undefined && { emergencyContact: body.emergencyContact ? required(body.emergencyContact, 'emergencyContact', 80) : null }),
    } });
    return (await this.helpers()).find((item) => item.id === id);
  }

  async removeHelper(id: string) {
    await this.prisma.helper.update({ where: { id }, data: { isActive: false } });
    return { success: true };
  }

  async createDriver(body: Record<string, unknown>) {
    const fullName = required(body.fullName, 'fullName', 100);
    const licenseNo = required(body.licenseNo, 'licenseNo', 50);
    return this.provider.createDriver({ ...body, fullName, licenseNo });
  }

  async updateDriver(id: string, body: Record<string, unknown>) {
    if (!uuid.test(id)) throw new BadRequestException('Invalid driver ID');
    const current = (await this.provider.drivers()).find((driver) => driver.id === id);
    if (!current) throw new NotFoundException('Driver not found');
    const fullName = body.fullName === undefined ? current.fullName : required(body.fullName, 'fullName', 100);
    const status = body.status === undefined ? current.status : required(body.status, 'status', 40);
    if (!STATUS.includes(String(status))) throw new BadRequestException('Invalid status');
    if (body.licenseExpiry !== undefined) optionalDate(body.licenseExpiry, 'licenseExpiry');
    if (body.joinDate !== undefined) optionalDate(body.joinDate, 'joinDate');
    return this.provider.updateDriver(id, { ...body, fullName, status });
  }

  async removeDriver(id: string) {
    if (!uuid.test(id)) throw new BadRequestException('Invalid driver ID');
    await this.provider.removeDriver(id);
    return { success: true };
  }
}
