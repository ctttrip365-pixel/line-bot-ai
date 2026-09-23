// lib/driver-grid.ts — human-readable "แถว=คนขับ, คอลัมน์=วันที่" summary tab,
// mirroring the layout of แชมป์'s existing AirAsia roster sheet so it's already
// familiar. Written into a new tab per month inside "CTT - Driver Roster &
// Dispatch" (e.g. tab "2026-10") — read-only for people, the system never reads
// this back; Assignments_Log/Availability_Monthly stay the real source of truth.

import { writeGrid, listCalendarEvents, isBookingEvent } from './gas-client';
import { listDrivers, Driver } from './drivers';
import { getAllAvailabilityForMonth, getChampAvailability } from './availability';
import { toBangkokParts } from './date-range';
import { log } from './log';

const AVAILABLE_ROW_COLOR = '#FFA500'; // ส้ม — วันที่มี booking จริง (isBookingEvent) ตามที่แชมป์สั่ง
const WHITE = '#ffffff'; // ส่งชัดเจนแทน null — Range.setBackgrounds ของ Apps Script ไม่ document พฤติกรรม null ไว้ กันเขียนพัง

const THAI_WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** วันที่ (YYYY-MM-DD) ในเดือนนี้ที่มี booking จริง (isBookingEvent) — ใช้ระบายสีแถว "Available" */
async function bookingDatesInMonth(month: string): Promise<Set<string>> {
  const daysCount = daysInMonth(month);
  const fromIso = `${month}-01T00:00:00+07:00`;
  const toIso = `${month}-${String(daysCount).padStart(2, '0')}T23:59:59+07:00`;
  const calRes = await listCalendarEvents(fromIso, toIso);
  const bookingDates = new Set<string>();
  if (calRes.ok && calRes.data) {
    for (const ev of calRes.data) {
      if (isBookingEvent(ev)) bookingDates.add(toBangkokParts(ev.start).date);
    }
  } else {
    log.error('driver_grid.calendar_read_failed', { month, error: calRes.error });
  }
  return bookingDates;
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
  const [drivers, monthRows, bookingDates] = await Promise.all([
    listDrivers(true),
    getAllAvailabilityForMonth(month),
    bookingDatesInMonth(month),
  ]);
  const active = drivers.filter((d) => String(d.active).toUpperCase() === 'TRUE');
  if (active.length === 0) {
    log.warn('driver_grid.no_active_drivers', { month });
    return;
  }

  const daysCount = daysInMonth(month);
  const [y, m] = month.split('-').map(Number);

  const weekdayRow: (string | number)[] = ['', ...Array.from({ length: daysCount }, (_, i) => THAI_WEEKDAYS[new Date(y, m - 1, i + 1).getDay()])];
  const dayNumberRow: (string | number)[] = ['ชื่อ', ...Array.from({ length: daysCount }, (_, i) => i + 1)];
  // แชมป์เพิ่มแถวนี้เองในชีต — ไม่มีเครื่องหมายในช่อง แค่ระบายพื้นหลังส้มถ้าวันนั้นมี booking จริง (ดู backgrounds ด้านล่าง)
  const availableRow: (string | number)[] = ['Available', ...Array.from({ length: daysCount }, () => '')];

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

  const values = [weekdayRow, dayNumberRow, availableRow, ...driverRows];

  // ระบายสีทุกช่องแบบชัดเจน (ขาวเป็นค่าเริ่มต้น) — ไม่พึ่ง null เพราะ Apps Script ไม่ document ว่ารองรับ
  const backgrounds: string[][] = values.map((row) => new Array(row.length).fill(WHITE));
  for (let d = 1; d <= daysCount; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    backgrounds[2][d] = bookingDates.has(date) ? AVAILABLE_ROW_COLOR : WHITE;
  }

  const res = await writeGrid(month, values, backgrounds);
  if (!res.ok) {
    log.error('driver_grid.write_failed', { month, error: res.error });
  } else {
    log.info('driver_grid.written', { month, driverCount: active.length, bookingDays: bookingDates.size });
  }
}
