import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma.service";
import {
  DirectoryClient,
  type DirectoryPerson,
} from "../auth/directory.client";
import {
  ASSERTION_SIGNER,
  AssertionSigner,
  ServiceTokenClient,
  VERIFY_CONFIG,
  type VerifyConfig,
} from "../auth/verify";
import type {
  AssignmentResources,
  DriverRecord,
  FleetProvider,
  GarageRecord,
  VehicleRecord,
} from "./fleet-provider";

export type FleetVehicle = {
  id: string;
  plateNumber: string;
  make: string | null;
  model: string;
  year: number | null;
  truckSizeCategory: string | null;
  capacity: number;
  odometer: number;
  status: "AVAILABLE" | "UNDER_REPAIR" | "UNDER_MAINTENANCE";
  garageId: string | null;
  updatedAt: string;
};
export function permanentCrew(
  person: DirectoryPerson | undefined,
  role: string,
) {
  return (
    !!person &&
    person.isActive &&
    !person.deleted &&
    !person.erased &&
    person.roles.includes(role) &&
    !(person.temporaryRoles ?? []).includes(role)
  );
}
const unavailable = () =>
  new ServiceUnavailableException({
    code: "FLEET_UNAVAILABLE",
    message: "Fleet service unavailable",
  });
const vehicleUnavailable = () =>
  new ConflictException({
    code: "VEHICLE_UNAVAILABLE",
    message: "Vehicle is unavailable",
  });
@Injectable()
export class VmmsFleetProvider
  implements FleetProvider, OnModuleInit, OnModuleDestroy
{
  private readonly tokens: ServiceTokenClient;
  private readonly root: string;
  private readonly cache = new Map<string, { until: number; value: unknown }>();
  private timer?: NodeJS.Timeout;
  constructor(
    private readonly prisma: PrismaService,
    private readonly directory: DirectoryClient,
    config: ConfigService,
    @Inject(VERIFY_CONFIG) verify: VerifyConfig,
    @Inject(ASSERTION_SIGNER) signer: AssertionSigner,
  ) {
    this.root = config
      .getOrThrow<string>("VMMS_INTERNAL_URL")
      .replace(/\/$/, "");
    this.tokens = new ServiceTokenClient({
      tokenUrl: `${verify.internalUrl}/auth/token`,
      signer,
      audience: "VMMS",
      scope: "fleet.read",
    });
  }
  onModuleInit() {
    void this.syncErased().catch(() => {});
    this.timer = setInterval(
      () => void this.syncErased().catch(() => {}),
      24 * 60 * 60 * 1000,
    );
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async close() {
    this.onModuleDestroy();
  }
  private async ask<T>(path: string, cached = false): Promise<T> {
    const old = this.cache.get(path);
    if (cached && old && old.until > Date.now()) return old.value as T;
    try {
      const result = await this.tokens.withToken(async (token) => {
        const res = await fetch(this.root + path, {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(3000),
        });
        if (res.status === 404)
          throw new NotFoundException("Unavailable vehicle");
        if (res.status === 401) {
          const body = await res.json().catch(() => ({}));
          if (body.code === "TOKEN_EXPIRED")
            throw new HttpException("Fleet token expired", 401);
          throw unavailable();
        }
        if (!res.ok) throw unavailable();
        return (await res.json()) as T;
      });
      if (cached)
        this.cache.set(path, { until: Date.now() + 30_000, value: result });
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw unavailable();
    }
  }
  async garages() {
    return (
      await this.ask<{ garages: GarageRecord[] }>("/vmms/fleet/garages", true)
    ).garages;
  }
  async vehicles(): Promise<VehicleRecord[]> {
    const [answer, profiles, garages] = await Promise.all([
      this.ask<{ vehicles: FleetVehicle[] }>("/vmms/fleet/vehicles", true),
      this.prisma.vehicleDispatchProfile.findMany(),
      this.garages(),
    ]);
    const byId = new Map(profiles.map((p) => [p.vehicleId, p]));
    const garageNames = new Map(garages.map((g) => [g.id, g.name]));
    return answer.vehicles.map((v) => {
      const p = byId.get(v.id);
      return {
        id: v.id,
        plateNumber: v.plateNumber,
        brand: v.make,
        model: v.model,
        year: v.year,
        type: p?.truckTypeId ?? v.truckSizeCategory,
        truckTypeId: p?.truckTypeId ?? v.truckSizeCategory,
        capacity: String(v.capacity),
        mileage: v.odometer,
        status: v.status,
        garage: v.garageId ? (garageNames.get(v.garageId) ?? null) : null,
        requiredHelpers: p?.requiredHelpers ?? 0,
        driverId: p?.driverId ?? null,
        statusReason: p?.statusReason ?? null,
        statusSince: p?.statusSince ?? null,
        expectedBackAt: p?.expectedBackAt ?? null,
        statusRemarks: p?.statusRemarks ?? null,
      };
    });
  }
  private mapDriver(d: any): DriverRecord {
    return {
      id: d.id,
      empId: d.empId,
      fullName: d.name,
      initials: d.initials ?? "",
      status: d.crewStatus,
      licenseNo: d.licenseNumber,
      licenseType: d.licenseType,
      licenseExpiry: d.licenseExpiry,
      totalTrips: d.totalTrips,
      joinDate: d.joinDate,
      contact: d.contact ?? "",
      email: d.email ?? "",
      address: d.address ?? "",
      emergencyName: d.emergencyName ?? "",
      emergencyContact: d.emergencyContact ?? "",
      updatedAt: d.updatedAt,
    };
  }
  async drivers(): Promise<DriverRecord[]> {
    const rows = await this.prisma.driver.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { name: "asc" },
    });
    const people = await this.directory.lookup(
      rows.flatMap((d) => (d.userId ? [d.userId] : [])),
    );
    return rows
      .filter((d) => !d.userId || permanentCrew(people.get(d.userId), "DRIVER"))
      .map((d) => this.mapDriver(d));
  }
  async assignmentResources(
    vehicleId: string,
    driverId: string,
  ): Promise<AssignmentResources> {
    let vehicle: FleetVehicle;
    try {
      vehicle = await this.ask<FleetVehicle>(
        `/vmms/fleet/vehicles/${encodeURIComponent(vehicleId)}`,
      );
    } catch (error) {
      if (error instanceof NotFoundException) throw vehicleUnavailable();
      throw error;
    }
    if (vehicle.status !== "AVAILABLE") throw vehicleUnavailable();
    const [profile, drivers] = await Promise.all([
      this.prisma.vehicleDispatchProfile.findUnique({ where: { vehicleId } }),
      this.drivers(),
    ]);
    const driver = drivers.find((d) => d.id === driverId);
    return {
      vehicle: {
        id: vehicle.id,
        status: vehicle.status,
        plateNumber: vehicle.plateNumber,
        requiredHelpers: profile?.requiredHelpers ?? 0,
      },
      driver: driver ? { id: driver.id, status: driver.status } : null,
    };
  }
  private data(body: Record<string, unknown>) {
    const data: Record<string, unknown> = {};
    const fields: Record<string, string> = {
      fullName: "name",
      licenseNo: "licenseNumber",
      licenseType: "licenseType",
      contact: "contact",
      email: "email",
      address: "address",
      status: "crewStatus",
      emergencyName: "emergencyName",
      emergencyContact: "emergencyContact",
    };
    for (const [from, to] of Object.entries(fields))
      if (body[from] !== undefined) data[to] = String(body[from]);
    for (const key of ["licenseExpiry", "joinDate"])
      if (body[key] !== undefined) {
        const raw = body[key];
        const date = raw
          ? new Date(`${String(raw).slice(0, 10)}T00:00:00Z`)
          : null;
        if (date && !Number.isFinite(date.getTime()))
          throw new BadRequestException("Invalid " + key);
        data[key] = date;
      }
    if (typeof data.name === "string")
      data.initials = data.name
        .split(/\s+/)
        .slice(0, 2)
        .map((p) => p[0])
        .join("");
    return data;
  }
  async createDriver(body: Record<string, unknown>) {
    const [{ value }] = await this.prisma.$queryRaw<
      Array<{ value: bigint }>
    >`SELECT nextval('dispatch_driver_emp_no_seq') AS value`;
    const d = await this.prisma.driver.create({
      data: {
        ...this.data(body),
        name: String(body.fullName),
        licenseNumber: String(body.licenseNo),
        empId: `DRV-${String(value).padStart(3, "0")}`,
      },
    });
    return this.mapDriver(d);
  }
  async updateDriver(id: string, body: Record<string, unknown>) {
    const d = await this.prisma.driver.update({
      where: { id },
      data: this.data(body),
    });
    return this.mapDriver(d);
  }
  async removeDriver(id: string) {
    await this.prisma.driver.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
    });
  }
  private async syncErased() {
    const [drivers, helpers] = await Promise.all([
      this.prisma.driver.findMany({
        where: { userId: { not: null } },
        select: { userId: true },
      }),
      this.prisma.helper.findMany({
        where: { userId: { not: null } },
        select: { userId: true },
      }),
    ]);
    const people = await this.directory.lookup(
      [...drivers, ...helpers].flatMap((d) => (d.userId ? [d.userId] : [])),
    );
    for (const p of people.values())
      if (p.erased) {
        const data = {
          name: "Deleted user",
          email: `deleted-${p.id}@erased.invalid`,
        };
        await this.prisma.driver.updateMany({ where: { userId: p.id }, data });
        await this.prisma.helper.updateMany({ where: { userId: p.id }, data });
      }
  }
}
