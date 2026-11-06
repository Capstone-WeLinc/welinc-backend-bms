import { randomUUID } from 'node:crypto';
import { ServiceUnavailableException, type OnApplicationShutdown } from '@nestjs/common';
import pg from 'pg';
import type { AssignmentResources, DriverRecord, FleetProvider, GarageRecord, VehicleRecord } from './fleet-provider';

/** Reads vehicles, drivers and garages from the shared WeLinc database. */
export class LocalFleetProvider implements FleetProvider, OnApplicationShutdown {
  private readonly partner: pg.Pool;

  constructor(connectionString = process.env.BMS_PARTNER_DATABASE_URL) {
    if ((process.env.BMS_FLEET_PROVIDER || 'local') !== 'local') {
      throw new Error('Only the local fleet provider is available');
    }
    if (!connectionString) throw new Error('BMS_PARTNER_DATABASE_URL is required for the local fleet provider');
    const address = new URL(connectionString);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(address.hostname)) {
      throw new Error('The local fleet provider accepts a loopback database only');
    }
    this.partner = new pg.Pool({ connectionString });
  }

  async close() { await this.partner.end(); }
  async onApplicationShutdown() { await this.close(); }

  private async query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) {
    try { return (await this.partner.query<T>(sql, params)).rows; }
    catch { throw new ServiceUnavailableException('Local partner fleet database unavailable'); }
  }

  garages() {
    return this.query<GarageRecord>('SELECT id, name FROM garages WHERE is_active = true AND deleted_at IS NULL ORDER BY name');
  }

  async vehicles(): Promise<VehicleRecord[]> {
    const rows = await this.query<Record<string, unknown>>(`SELECT v.id, v.plate_number, v.alias, v.brand, v.model, v.type, v.year, v.capacity, v.color, v.fuel, v.status,
      v.required_helpers, v.mileage, v.reg_expiry, v.ins_expiry, v.last_maintenance, v.next_maintenance, v.driver_id, v.garage,
      COALESCE(to_jsonb(v)->>'truck_type_id', v.type) AS truck_type_id,
      to_jsonb(v)->>'status_reason' AS status_reason, to_jsonb(v)->>'status_since' AS status_since,
      to_jsonb(v)->>'expected_back_at' AS expected_back_at, to_jsonb(v)->>'status_remarks' AS status_remarks
      FROM vehicles v WHERE v.is_active = true AND v.deleted_at IS NULL ORDER BY v.plate_number`);
    return rows.map((v) => ({
      id: String(v.id), plateNumber: String(v.plate_number), alias: v.alias as string | null,
      brand: v.brand as string | null, model: v.model as string | null, type: v.type as string | null,
      truckTypeId: v.truck_type_id as string | null,
      year: v.year as number | null, capacity: String(v.capacity ?? ''), color: v.color as string | null,
      fuel: v.fuel as string | null, status: String(v.status), requiredHelpers: Number(v.required_helpers),
      mileage: v.mileage as number | null, regExpiry: v.reg_expiry, insExpiry: v.ins_expiry,
      lastMaintenance: v.last_maintenance, nextMaintenance: v.next_maintenance,
      driverId: v.driver_id as string | null, garage: v.garage as string | null,
      statusReason: v.status_reason as string | null, statusSince: v.status_since,
      expectedBackAt: v.expected_back_at, statusRemarks: v.status_remarks as string | null,
    }));
  }

  async drivers(): Promise<DriverRecord[]> {
    const rows = await this.query<Record<string, unknown>>(`SELECT id, emp_id, name, initials, crew_status, license_number, license_type, license_expiry,
      total_trips, join_date, contact, email, address, emergency_name, emergency_contact, vehicle_id, is_verified, updated_at
      FROM drivers WHERE is_active = true AND deleted_at IS NULL ORDER BY name`);
    return rows.map((d) => ({
      id: String(d.id), empId: String(d.emp_id ?? ''), fullName: String(d.name), initials: String(d.initials ?? ''),
      status: String(d.crew_status ?? 'Available'), licenseNo: String(d.license_number ?? ''),
      licenseType: String(d.license_type ?? 'Professional'), licenseExpiry: d.license_expiry,
      totalTrips: d.total_trips as number | null, joinDate: d.join_date,
      contact: String(d.contact ?? ''), email: String(d.email ?? ''), address: String(d.address ?? ''),
      emergencyName: String(d.emergency_name ?? ''), emergencyContact: String(d.emergency_contact ?? ''),
      vehicleId: d.vehicle_id as string | null, isVerified: d.is_verified as boolean | undefined, updatedAt: d.updated_at,
    }));
  }

  async assignmentResources(vehicleId: string, driverId: string): Promise<AssignmentResources> {
    const [vehicles, drivers] = await Promise.all([
      this.query<{ id: string; status: string; plate_number: string; required_helpers: number }>(
        'SELECT id, status, plate_number, required_helpers FROM vehicles WHERE id=$1::uuid AND is_active=true AND deleted_at IS NULL', [vehicleId]),
      this.query<{ id: string; crew_status: string }>(
        'SELECT id, crew_status FROM drivers WHERE id=$1::uuid AND is_active=true AND deleted_at IS NULL', [driverId]),
    ]);
    return {
      vehicle: vehicles[0] ? {
        id: String(vehicles[0].id), status: vehicles[0].status,
        plateNumber: vehicles[0].plate_number, requiredHelpers: vehicles[0].required_helpers,
      } : null,
      driver: drivers[0] ? { id: String(drivers[0].id), status: drivers[0].crew_status ?? 'Available' } : null,
    };
  }

  async createDriver(body: Record<string, unknown>) {
    const name = String(body.fullName);
    const id = randomUUID();
    // Employee IDs continue the DRV-### sequence (DRV-013 after DRV-012). Deleted drivers count too, so an ID is never reused.
    const rows = await this.query<{ id: string }>(`INSERT INTO drivers (id, emp_id, name, license_number, is_verified, is_active, created_at, updated_at,
      initials, contact, email, address, license_type, license_expiry, crew_status, join_date, emergency_name, emergency_contact)
      VALUES ($1::uuid, (SELECT 'DRV-' || lpad((COALESCE(MAX(substring(emp_id FROM '^DRV-([0-9]+)$')::int), 0) + 1)::text, 3, '0') FROM drivers),
        $2, $3, false, true, now(), now(), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
    [id, name, body.licenseNo,
      name.split(/\s+/).slice(0, 2).map((part) => part[0].toUpperCase()).join(''), body.contact || null,
      body.email || null, body.address || null, body.licenseType || 'Professional', body.licenseExpiry || null,
      body.status || 'Available', body.joinDate || null, body.emergencyName || null, body.emergencyContact || null]);
    return (await this.drivers()).find((driver) => driver.id === rows[0].id);
  }

  async updateDriver(id: string, body: Record<string, unknown>) {
    const current = (await this.drivers()).find((driver) => driver.id === id);
    if (!current) return undefined;
    const name = String(body.fullName ?? current.fullName);
    await this.query(`UPDATE drivers SET name=$2, initials=$3, license_number=$4, license_type=$5, license_expiry=$6,
      contact=$7, email=$8, address=$9, crew_status=$10, join_date=$11, emergency_name=$12, emergency_contact=$13,
      updated_at=now() WHERE id=$1::uuid`,
    [id, name, name.split(/\s+/).slice(0, 2).map((part) => part[0].toUpperCase()).join(''),
      body.licenseNo ?? current.licenseNo, body.licenseType ?? current.licenseType,
      body.licenseExpiry ?? current.licenseExpiry, body.contact ?? current.contact, body.email ?? current.email,
      body.address ?? current.address, body.status ?? current.status, body.joinDate ?? current.joinDate,
      body.emergencyName ?? current.emergencyName, body.emergencyContact ?? current.emergencyContact]);
    return (await this.drivers()).find((driver) => driver.id === id);
  }

  async removeDriver(id: string) {
    await this.query('UPDATE drivers SET is_active=false, deleted_at=now(), updated_at=now() WHERE id=$1::uuid', [id]);
  }
}
