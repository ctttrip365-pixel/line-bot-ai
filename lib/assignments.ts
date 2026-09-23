// lib/assignments.ts — "Assignments_Log" tab: the primary machine-queryable index
// of which driver is on which booking. The Calendar event's "Driver: ..." description
// line is only a human-readable mirror of the `confirmed` rows here — this Sheet is
// what the code actually queries for conflicts and for "who's driving tomorrow".

import { sheetRead, sheetAppendRow, sheetUpdateRow, updateCalendarEventDriver, listCalendarEvents } from './gas-client';
import { toBangkokParts } from './date-range';
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

/**
 * แชมป์กด "ยืนยัน" ใน Telegram — เติมบรรทัด Driver: ใน Calendar description ด้วย
 * รองรับ 2 เคส: (1) booking ที่เคย proposeAssignment ไว้แล้ว (มีแถวอยู่แล้ว) → update
 * (2) booking ที่ไม่เคยจับคู่อัตโนมัติได้เลย (noMatch) แล้วแชมป์กด "จัดคนขับเอง" → ไม่มีแถวเลย ต้อง insert ใหม่
 * เคส (2) ไม่รู้ job_date/job_start_time จาก callback_data (Telegram จำกัดความยาวข้อความปุ่ม ใส่ไปด้วยไม่ได้)
 * เลยต้องไปหาจาก Calendar event จริงแทน
 */
export async function confirmAssignment(
  bookingEventId: string,
  driverId: string,
  driverDisplayName: string
): Promise<void> {
  const existing = await listAssignments();
  const hasRow = existing.some((a) => a.booking_event_id === bookingEventId);

  if (hasRow) {
    await sheetUpdateRow('Assignments_Log', 'booking_event_id', bookingEventId, {
      driver_id: driverId,
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
    });
  } else {
    const today = new Date();
    const toDate = new Date(today);
    toDate.setDate(toDate.getDate() + 60);
    const fromIso = `${today.toISOString().slice(0, 10)}T00:00:00+07:00`;
    const toIso = `${toDate.toISOString().slice(0, 10)}T23:59:59+07:00`;
    const calRes = await listCalendarEvents(fromIso, toIso);
    const event = calRes.ok ? calRes.data?.find((e) => e.eventId === bookingEventId) : undefined;
    const parts = event ? toBangkokParts(event.start) : { date: '', time: '' };
    if (!event) log.warn('assignment.confirm_new_row_event_not_found', { bookingEventId });

    await sheetAppendRow('Assignments_Log', {
      booking_event_id: bookingEventId,
      calendar_id: 'ctt.trip365@gmail.com',
      driver_id: driverId,
      status: 'confirmed',
      job_date: parts.date,
      job_start_time: parts.time,
      proposed_at: '',
      confirmed_at: new Date().toISOString(),
      notified_at: '',
    });
  }

  // ไม่ต้องใส่ prefix "Driver: " เอง — Apps Script (calendarUpdateDriver_) เติมให้แล้ว
  // ใส่ซ้ำเองมาก่อนหน้านี้ทำให้ description ออกมาเป็น "Driver: Driver: Ball (ball)"
  await updateCalendarEventDriver(bookingEventId, `${driverDisplayName} (${driverId})`);
  log.info('assignment.confirmed', { bookingEventId, driverId, wasNew: !hasRow });
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

/** งานที่ยืนยันแล้ว (confirmed/notified) ของคนขับคนนี้ ตั้งแต่วันนี้เป็นต้นไป เรียงตามวันที่/เวลา — ใช้ตอนคนขับพิมพ์ "เช็คงาน" */
export function upcomingConfirmedAssignments(assignments: AssignmentRow[], driverId: string): AssignmentRow[] {
  const today = new Date().toISOString().slice(0, 10);
  return assignments
    .filter(
      (a) => a.driver_id === driverId && (a.status === 'confirmed' || a.status === 'notified') && a.job_date >= today
    )
    .sort((a, b) => (a.job_date + a.job_start_time).localeCompare(b.job_date + b.job_start_time));
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
