import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma.service";
import { DirectoryClient } from "../auth/directory.client";
import { accountFields, linkedCrew, type Linked } from "./crew-roster";
import {
  ASSERTION_SIGNER,
  AssertionSigner,
  ServiceTokenClient,
  VERIFY_CONFIG,
  type VerifyConfig,
} from "../auth/verify";
import type { Driver } from "@prisma/client";
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
// Kept here too for older imports; it lives with the crew roster now.
export { permanentCrew } from "./crew-roster";
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
export class VmmsFleetProvider implements FleetProvider {
  private readonly tokens: ServiceTokenClient;
  private readonly root: string;
  private readonly cache = new Map<string, { until: number; value: unknown }>();
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
  async close() {}
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
  private mapDriver({ row: d, person }: Linked<Driver>): DriverRecord {
    return {
      id: d.id,
      ...accountFields(person),
      status: d.crewStatus,
      licenseNo: d.licenseNumber ?? "",
      licenseType: d.licenseType,
      licenseExpiry: d.licenseExpiry,
      address: d.address ?? "",
      emergencyName: d.emergencyName ?? "",
      emergencyContact: d.emergencyContact ?? "",
      updatedAt: d.updatedAt,
    };
  }
  /** Everyone who holds the Driver role in Auth, with their BMS details (spec bms/0012). */
  async drivers(): Promise<DriverRecord[]> {
    return (await linkedCrew(this.prisma, this.directory, "DRIVER")).map((d) =>
      this.mapDriver(d),
    );
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
  /** Only the details BMS keeps; name, email and contact number are edited in the portal. */
  private data(body: Record<string, unknown>) {
    const data: Record<string, unknown> = {};
    const fields: Record<string, string> = {
      licenseNo: "licenseNumber",
      licenseType: "licenseType",
      address: "address",
      status: "crewStatus",
      emergencyName: "emergencyName",
      emergencyContact: "emergencyContact",
    };
    for (const [from, to] of Object.entries(fields))
      if (body[from] !== undefined)
        data[to] = body[from] === null || body[from] === "" ? null : String(body[from]);
    if (data.crewStatus === null) delete data.crewStatus;
    if (data.licenseType === null) delete data.licenseType;
    for (const key of ["licenseExpiry"])
      if (body[key] !== undefined) {
        const raw = body[key];
        const date = raw
          ? new Date(`${String(raw).slice(0, 10)}T00:00:00Z`)
          : null;
        if (date && !Number.isFinite(date.getTime()))
          throw new BadRequestException("Invalid " + key);
        data[key] = date;
      }
    return data;
  }
  async updateDriver(id: string, body: Record<string, unknown>) {
    await this.prisma.driver.update({ where: { id }, data: this.data(body) });
    return (await this.drivers()).find((driver) => driver.id === id);
  }
}
