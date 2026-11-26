export const FLEET_PROVIDER = Symbol('FLEET_PROVIDER');

export type GarageRecord = { id: string; name: string };
export type VehicleRecord = {
  id: string; plateNumber: string; alias?: string | null; brand?: string | null; model?: string | null;
  type?: string | null; truckTypeId?: string | null; year?: number | null; capacity: string; color?: string | null; fuel?: string | null;
  status: string; requiredHelpers: number; mileage?: number | null; regExpiry?: unknown; insExpiry?: unknown;
  lastMaintenance?: unknown; nextMaintenance?: unknown; driverId?: string | null; garage?: string | null;
  statusReason?: string | null; statusSince?: unknown; expectedBackAt?: unknown; statusRemarks?: string | null;
};
/** A driver: `userId`, `fullName`, `email` and `contact` come from Auth, the rest from BMS (spec bms/0012). */
export type DriverRecord = {
  id: string; userId: string; fullName: string; email: string; contact: string; status: string;
  licenseNo: string; licenseType: string; licenseExpiry?: unknown;
  address: string; emergencyName: string; emergencyContact: string;
  vehicleId?: string | null; isVerified?: boolean; updatedAt?: unknown;
};
export type AssignmentResources = {
  vehicle: { id: string; status: string; plateNumber: string; requiredHelpers: number } | null;
  driver: { id: string; status: string } | null;
};

export interface FleetProvider {
  garages(): Promise<GarageRecord[]>;
  vehicles(): Promise<VehicleRecord[]>;
  drivers(): Promise<DriverRecord[]>;
  assignmentResources(vehicleId: string, driverId: string): Promise<AssignmentResources>;
  /** Saves only the BMS details; a driver is never created or removed here (spec bms/0012). */
  updateDriver(id: string, body: Record<string, unknown>): Promise<DriverRecord | undefined>;
  close(): Promise<void>;
}
