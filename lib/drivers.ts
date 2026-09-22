// lib/drivers.ts — "Drivers" tab: driver_id, display_name, line_user_id, phone,
// license_class, license_expiry, active, role (owner/driver), joined_date, notes
//
// Adding a driver = adding a row in the Sheet. No code change needed.

import { sheetRead } from './gas-client';
import { log } from './log';

export interface Driver {
  driver_id: string;
  display_name: string;
  line_user_id: string;
  phone: string;
  license_class: string;
  license_expiry: string;
  active: string; // "TRUE" / "FALSE" as stored in the Sheet
  role: 'owner' | 'driver';
  joined_date: string;
  notes: string;
}

const CACHE_TTL_MS = 60_000; // same 60s convention as lib/sheet.ts's FAQ cache
let cache: { at: number; drivers: Driver[] } | null = null;

export async function listDrivers(forceRefresh = false): Promise<Driver[]> {
  if (!forceRefresh && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.drivers;
  }

  const res = await sheetRead<Driver[]>('Drivers');
  if (!res.ok || !res.data) {
    log.error('drivers.read_failed', { error: res.error });
    // ถ้ามี cache เก่าอยู่ใช้ต่อไปก่อนดีกว่าไม่มีเลย (fail-open ต่อการ route ผิดเป็นความเสี่ยงต่ำ)
    return cache?.drivers ?? [];
  }

  cache = { at: Date.now(), drivers: res.data };
  return res.data;
}

/** Used by the LINE webhook to decide: this sender is a driver, not a customer. */
export async function findDriverByLineId(lineUserId: string): Promise<Driver | null> {
  const drivers = await listDrivers();
  return (
    drivers.find(
      (d) => d.line_user_id === lineUserId && String(d.active).toUpperCase() === 'TRUE'
    ) ?? null
  );
}

export function findDriverById(drivers: Driver[], driverId: string): Driver | undefined {
  return drivers.find((d) => d.driver_id === driverId);
}
