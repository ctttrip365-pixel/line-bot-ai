// lib/assignments.ts — "Assignments_Log" tab: the primary machine-queryable index
// of which driver is on which booking. The Calendar event's "Driver: ..." description
// line is only a human-readable mirror of the `confirmed` rows here — this Sheet is
// what the code actually queries for conflicts and for "who's driving tomorrow".

import { sheetRead, sheetAppendRow, sheetUpdateRow, updateCalendarEventDriver, listCalendarEvents } from './gas-client';
import { toBangkokParts } from './date-range';
import { log } from './log';
import { sendTelegramMessage } from './telegram';
import { Client } from '@line/bot-sdk';
import { listDrivers } from './drivers';

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

/**
 * อ่าน Assignments_Log แบบ "ล้มเหลวต้องรู้" (listAssignments คืน [] เมื่อพัง ซึ่งแยกไม่ออกจาก "ไม่มีงาน")
 * ลองซ้ำ 1 ครั้ง เพราะ Apps Script cold start ครั้งแรกมักหมดเวลา ครั้งที่สองมักเร็ว
 */
export async function listAssignmentsStrict(): Promise<AssignmentRow[]> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await sheetRead<AssignmentRow[]>('Assignments_Log');
    if (res.ok && res.data) return res.data;
    log.warn('assignments.strict_read_retry', { attempt, error: res.error });
  }
  throw new Error('assignments_read_failed');
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
  // ผลของ GAS ไม่ throw แม้ล้มเหลว (คืน { ok:false }) — เคยเงียบหายจนปฏิทินไม่มีชื่อคนขับทั้งที่ชีตยืนยันแล้ว
  // (VTL2711, 2026-09-24) เลยต้องเช็คผลเอง ลองซ้ำ 1 ครั้ง ถ้ายังพลาดแจ้งแชมป์ใน Telegram ให้เติมเอง
  const driverLine = `${driverDisplayName} (${driverId})`;
  let calRes = await updateCalendarEventDriver(bookingEventId, driverLine);
  if (!calRes.ok) {
    log.warn('assignment.calendar_driver_retry', { bookingEventId, error: calRes.error });
    calRes = await updateCalendarEventDriver(bookingEventId, driverLine);
  }
  if (!calRes.ok) {
    log.error('assignment.calendar_driver_failed', { bookingEventId, error: calRes.error });
    await sendTelegramMessage(
      [
        '⚠️ <b>เขียนชื่อคนขับลงปฏิทินไม่สำเร็จ</b>',
        `ชีตบันทึกแล้ว: ${driverLine}`,
        `event: ${bookingEventId}`,
        'รบกวนเติมบรรทัด Driver: ในปฏิทินเอง',
      ].join('\n')
    );
  }
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

export interface CancelResult {
  found: boolean;
  driverId?: string;
  driverName?: string;
  jobDate?: string;
  jobStartTime?: string;
  driverNotified: boolean; // ส่งข้อความยกเลิกให้คนขับทาง LINE แล้วหรือไม่
  calendarOk: boolean;
}

/**
 * แชมป์สั่ง "ยกเลิกคนขับ" ของงานที่ลงไว้แล้ว (เช่น ลงผิดคน)
 *  - mode 'manual': สถานะ → cancelled  (ระบบจับคู่อัตโนมัติจะไม่แตะงานนี้อีก แชมป์จัดคนขับเองด้วยปุ่ม "จัดคนขับเอง")
 *  - mode 'auto'  : สถานะ → needs_reassignment (ระบบเสนอคนขับใหม่ให้แชมป์กดยืนยันในรอบถัดไป)
 *  - ลบบรรทัด "Driver:" ออกจากปฏิทิน (ลองซ้ำ 1 ครั้ง ถ้าพลาดแจ้งแชมป์)
 *  - ถ้าคนขับเคยได้รับแจ้งงานแล้ว (notified_at) ส่ง LINE บอกว่างานถูกยกเลิก กันไปผิดงาน
 */
export async function cancelAssignment(bookingEventId: string, mode: 'manual' | 'auto'): Promise<CancelResult> {
  const rows = await listAssignments();
  const row = [...rows].reverse().find((a) => a.booking_event_id === bookingEventId);
  if (!row || row.status === 'cancelled') {
    return { found: false, driverNotified: false, calendarOk: true };
  }

  await sheetUpdateRow('Assignments_Log', 'booking_event_id', bookingEventId, {
    status: mode === 'manual' ? 'cancelled' : 'needs_reassignment',
  });

  let calRes = await updateCalendarEventDriver(bookingEventId, null);
  if (!calRes.ok) {
    log.warn('assignment.cancel_calendar_retry', { bookingEventId, error: calRes.error });
    calRes = await updateCalendarEventDriver(bookingEventId, null);
  }
  if (!calRes.ok) log.error('assignment.cancel_calendar_failed', { bookingEventId, error: calRes.error });

  const drivers = await listDrivers();
  const driver = drivers.find((d) => d.driver_id === row.driver_id);

  let driverNotified = false;
  if (row.notified_at && driver?.line_user_id) {
    try {
      await new Client({
        channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
        channelSecret: process.env.LINE_CHANNEL_SECRET!,
      }).pushMessage(driver.line_user_id, {
        type: 'text',
        text: `❌ งานวันที่ ${row.job_date} เวลา ${row.job_start_time} น. ถูกยกเลิกแล้วครับ ไม่ต้องไปรับงานนี้ ขออภัยที่แจ้งผิดนะครับ 🙏`,
      });
      driverNotified = true;
    } catch (err) {
      log.error('assignment.cancel_notify_driver_failed', { bookingEventId, err: (err as Error).message });
    }
  }

  log.info('assignment.cancelled', { bookingEventId, mode, driverId: row.driver_id, driverNotified, calendarOk: calRes.ok });
  return {
    found: true,
    driverId: row.driver_id,
    driverName: driver?.display_name ?? row.driver_id,
    jobDate: row.job_date,
    jobStartTime: row.job_start_time,
    driverNotified,
    calendarOk: calRes.ok,
  };
}
