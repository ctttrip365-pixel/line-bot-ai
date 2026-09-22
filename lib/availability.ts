// lib/availability.ts — "Availability_Monthly" tab (one row per driver per month)
// + Champ's own availability, derived from the AirAsia shift Calendar (no manual entry).

import { sheetRead, sheetAppendRow, sheetUpdateRow, listCalendarEvents } from './gas-client';
import { log } from './log';

export interface AvailabilityRow {
  driver_id: string;
  month: string; // YYYY-MM
  available_dates: string; // comma-separated YYYY-MM-DD
  submitted_at: string;
  status: 'pending' | 'submitted' | 'reminded';
}

export async function getAvailability(driverId: string, month: string): Promise<string[]> {
  const res = await sheetRead<AvailabilityRow[]>('Availability_Monthly');
  if (!res.ok || !res.data) {
    log.error('availability.read_failed', { error: res.error });
    return [];
  }
  const row = res.data.find((r) => r.driver_id === driverId && r.month === month);
  return row?.available_dates ? row.available_dates.split(',').map((d) => d.trim()) : [];
}

export async function submitAvailability(
  driverId: string,
  month: string,
  dates: string[]
): Promise<void> {
  const existing = await sheetRead<AvailabilityRow[]>('Availability_Monthly');
  const hasRow = existing.ok && existing.data?.some((r) => r.driver_id === driverId && r.month === month);

  const patch = {
    available_dates: dates.join(','),
    submitted_at: new Date().toISOString(),
    status: 'submitted' as const,
  };

  if (hasRow) {
    await sheetUpdateRow('Availability_Monthly', 'driver_id', driverId, { month, ...patch });
  } else {
    await sheetAppendRow('Availability_Monthly', { driver_id: driverId, month, ...patch });
  }
  log.info('availability.submitted', { driverId, month, dateCount: dates.length });
}

/**
 * แชมป์เองไม่กรอกวันว่าง — วัน OFF ในปฏิทินกะ AirAsia (สร้างโดย skill `airasia-shift`,
 * all-day event ชื่อ "OFF" ที่ description มีคำว่า "Suttana") = วันว่างขับของแชมป์
 */
export async function getChampAvailability(fromIso: string, toIso: string): Promise<string[]> {
  const res = await listCalendarEvents(fromIso, toIso);
  if (!res.ok || !res.data) {
    log.error('champ_availability.read_failed', { error: res.error });
    return [];
  }
  return res.data
    .filter((e) => e.summary === 'OFF' && e.description?.includes('Suttana'))
    .map((e) => e.start.slice(0, 10)); // YYYY-MM-DD
}
