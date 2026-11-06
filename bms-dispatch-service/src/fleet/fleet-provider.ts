export const FLEET_PROVIDER = Symbol('FLEET_PROVIDER');

export type GarageRecord = { id: string; name: string };
export type VehicleRecord = {
  id: string; plateNumber: string; alias?: string | null; brand?: string | null; model?: string | null;
  type?: string | null; truckTypeId?: string | null; year?: number | null; capacity: string; color?: string | null; fuel?: string | null;
  status: string; requiredHelpers: number; mileage?: number | null; regExpiry?: unknown; insExpiry?: unknown;
  lastMaintenance?: unknown; nextMaintenance?: unknown; driverId?: string | null; garage?: string | null;
  statusReason?: string | null; statusSince?: unknown; expectedBackAt?: unknown; statusRemarks?: string | null;
};
export type DriverRecord = {
  id: string; empId: string; fullName: string; initials: string; status: string; licenseNo: string;
  licenseType: string; licenseExpiry?: unknown; totalTrips?: number | null; joinDate?: unknown;
  contact: string; email: string; address: string; emergencyName: string; emergencyContact: string;
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
  createDriver(body: Record<string, unknown>): Promise<DriverRecord | undefined>;
  updateDriver(id: string, body: Record<string, unknown>): Promise<DriverRecord | undefined>;
  removeDriver(id: string): Promise<void>;
  close(): Promise<void>;
}
