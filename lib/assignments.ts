// lib/assignments.ts — "Assignments_Log" tab: the primary machine-queryable index
// of which driver is on which booking. The Calendar event's "Driver: ..." description
// line is only a human-readable mirror of the `confirmed` rows here — this Sheet is
// what the code actually queries for conflicts and for "who's driving tomorrow".

import { sheetRead, sheetAppendRow, sheetUpdateRow, updateCalendarEventDriver } from './gas-client';
import { log } from './log';

export type AssignmentStatus =
  | 'proposed'
  | 'confirmed'
  | 'notified'
  | 'cancelled'
  | 'needs_reassignment';

export interface AssignmentRow {
  booking_event_id: string;
  calendar_id: string;
  driver_id: string;
  status: AssignmentStatus;
  job_date: string; // YYYY-MM-DD
  job_start_time: string; // HH:MM
  proposed_at: string;
  confirmed_at: string;
  notified_at: string;
}

export async function listAssignments(): Promise<AssignmentRow[]> {
  const res = await sheetRead<AssignmentRow[]>('Assignments_Log');
  if (!res.ok || !res.data) {
    log.error('assignments.read_failed', { error: res.error });
    return [];
  }
  return res.data;
}

export async function proposeAssignment(row: {
  bookingEventId: string;
  calendarId: string;
  driverId: string;
  jobDate: string;
  jobStartTime: string;
}): Promise<void> {
  await sheetAppendRow('Assignments_Log', {
    booking_event_id: row.bookingEventId,
    calendar_id: row.calendarId,
    driver_id: row.driverId,
    status: 'proposed',
    job_date: row.jobDate,
    job_start_time: row.jobStartTime,
    proposed_at: new Date().toISOString(),
    confirmed_at: '',
    notified_at: '',
  });
  log.info('assignment.proposed', row);
}

/** แชมป์กด "ยืนยัน" ใน Telegram — เติมบรรทัด Driver: ใน Calendar description ด้วย */
export async function confirmAssignment(
  bookingEventId: string,
  driverId: string,
  driverDisplayName: string
): Promise<void> {
  await sheetUpdateRow('Assignments_Log', 'booking_event_id', bookingEventId, {
    driver_id: driverId,
    status: 'confirmed',
    confirmed_at: new Date().toISOString(),
  });
  // ไม่ต้องใส่ prefix "Driver: " เอง — Apps Script (calendarUpdateDriver_) เติมให้แล้ว
  // ใส่ซ้ำเองมาก่อนหน้านี้ทำให้ description ออกมาเป็น "Driver: Driver: Ball (ball)"
  await updateCalendarEventDriver(bookingEventId, `${driverDisplayName} (${driverId})`);
  log.info('assignment.confirmed', { bookingEventId, driverId });
}

export async function markNotified(bookingEventId: string): Promise<void> {
  await sheetUpdateRow('Assignments_Log', 'booking_event_id', bookingEventId, {
    status: 'notified',
    notified_at: new Date().toISOString(),
  });
}

/** ขอลาอนุมัติแล้วชนกับ assignment เดิม — เปิดให้จับคู่ใหม่ ไม่ auto-reassign เอง */
export async function markNeedsReassignment(bookingEventId: string): Promise<void> {
  await sheetUpdateRow('Assignments_Log', 'booking_event_id', bookingEventId, {
    status: 'needs_reassignment',
  });
  // หมายเหตุ: ตั้งใจไม่ลบบรรทัด Driver: ใน Calendar ทันที — รอแชมป์ยืนยันคนขับคนใหม่ก่อน
}

export function hasConflict(
  assignments: AssignmentRow[],
  driverId: string,
  jobDate: string,
  jobStartTime: string,
  durationHours: number
): boolean {
  const start = toMinutes(jobStartTime);
  const end = start + durationHours * 60;
  return assignments.some((a) => {
    if (a.driver_id !== driverId || a.job_date !== jobDate) return false;
    if (a.status === 'cancelled') return false;
    const otherStart = toMinutes(a.job_start_time);
    const otherEnd = otherStart + 2 * 60; // ไม่ทราบระยะเวลาที่แน่นอนของงานเดิม ใช้ 2ชม.ขั้นต่ำแบบระวังไว้ก่อน
    return start < otherEnd && otherStart < end;
  });
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
