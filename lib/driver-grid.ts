// lib/driver-grid.ts — human-readable "แถว=คนขับ, คอลัมน์=วันที่" summary tab,
// mirroring the layout of แชมป์'s existing AirAsia roster sheet so it's already
// familiar. Written into a new tab per month inside "CTT - Driver Roster &
// Dispatch" (e.g. tab "2026-10") — read-only for people, the system never reads
// this back; Assignments_Log/Availability_Monthly stay the real source of truth.

import { writeGrid } from './gas-client';
import { listDrivers, Driver } from './drivers';
import { getAllAvailabilityForMonth, getChampAvailability } from './availability';
import { log } from './log';

const THAI_WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

async function driverAvailableSet(driver: Driver, month: string, monthRows: { driver_id: string; available_dates: string }[]): Promise<Set<string>> {
  if (driver.role === 'owner') {
    const daysCount = daysInMonth(month);
    const fromIso = `${month}-01T00:00:00+07:00`;
    const toIso = `${month}-${String(daysCount).padStart(2, '0')}T23:59:59+07:00`;
    return new Set(await getChampAvailability(fromIso, toIso));
  }
  const row = monthRows.find((r) => r.driver_id === driver.driver_id);
  // token อาจเป็น "YYYY-MM-DD" เฉยๆ หรือ "YYYY-MM-DD#eventId" (วันที่มีหลายงาน — ดู lib/job-availability.ts)
  // ตัด "#eventId" ทิ้งก่อนเทียบ เพราะกริดนี้สรุปแค่ระดับวัน ไม่แยกรายงาน
  return new Set(
    row?.available_dates ? row.available_dates.split(',').map((d) => d.trim().split('#')[0]) : []
  );
}

export async function buildAndWriteMonthGrid(month: string): Promise<void> {
  const [drivers, monthRows] = await Promise.all([listDrivers(true), getAllAvailabilityForMonth(month)]);
  const active = drivers.filter((d) => String(d.active).toUpperCase() === 'TRUE');
  if (active.length === 0) {
    log.warn('driver_grid.no_active_drivers', { month });
    return;
  }

  const daysCount = daysInMonth(month);
  const [y, m] = month.split('-').map(Number);

  const weekdayRow: (string | number)[] = ['', ...Array.from({ length: daysCount }, (_, i) => THAI_WEEKDAYS[new Date(y, m - 1, i + 1).getDay()])];
  const dayNumberRow: (string | number)[] = ['ชื่อ', ...Array.from({ length: daysCount }, (_, i) => i + 1)];

  const driverRows: (string | number)[][] = [];
  for (const driver of active) {
    const availableSet = await driverAvailableSet(driver, month, monthRows);
    const row: (string | number)[] = [driver.display_name];
    for (let d = 1; d <= daysCount; d++) {
      const date = `${month}-${String(d).padStart(2, '0')}`;
      row.push(availableSet.has(date) ? '✓' : '');
    }
    driverRows.push(row);
  }

  const values = [weekdayRow, dayNumberRow, ...driverRows];
  const res = await writeGrid(month, values);
  if (!res.ok) {
    log.error('driver_grid.write_failed', { month, error: res.error });
  } else {
    log.info('driver_grid.written', { month, driverCount: active.length });
  }
}
