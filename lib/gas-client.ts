// lib/gas-client.ts — generic client for the Google Apps Script web app
// This is the ONE integration point CTT's bot has into Google (Calendar + Sheets),
// running under แชมป์'s own Google account — see apps-script/dispatch-extensions.gs
// for the server-side actions this client calls.
//
// lib/calendar.ts's `createCalendarEvent` keeps calling the same webhook with the
// legacy no-`action` shape for the live customer-booking flow — untouched by this file.

import { log } from './log';

export interface GasResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

// การอ่านซ้ำได้ปลอดภัย (ไม่เปลี่ยนข้อมูล) — ลองใหม่ได้เมื่อคำขอค้าง
// ส่วนการเขียน (append/update/create) ห้ามลองซ้ำเองเพราะคำขอแรกอาจทำงานสำเร็จไปแล้วแต่คำตอบไม่กลับมา (จะได้ข้อมูลซ้ำ)
const IDEMPOTENT_ACTIONS = new Set(['sheet_read', 'calendar_list']);

async function callGasOnce<T>(
  webhookUrl: string,
  action: string,
  payload: Record<string, unknown>,
  timeoutMs: number
): Promise<GasResponse<T>> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    log.error('gas.http_error', { action, status: res.status });
    return { ok: false, error: `HTTP ${res.status}` };
  }
  const json = (await res.json()) as GasResponse<T>;
  log.info('gas.call_ok', { action, ok: json.ok });
  return json;
}

async function callGas<T = unknown>(action: string, payload: Record<string, unknown>): Promise<GasResponse<T>> {
  const webhookUrl = process.env.CALENDAR_WEBHOOK_URL;
  if (!webhookUrl) {
    log.error('gas.no_webhook_url', { action });
    return { ok: false, error: 'CALENDAR_WEBHOOK_URL not set' };
  }

  // Apps Script เองรันเสร็จใน 0.4–3 วินาที (หน้า Executions 2026-10-07) แต่บางครั้งคำตอบไม่กลับมาถึง Vercel เลย (เห็น 16:49:
  // รันเสร็จใน 2.0 วิ แต่ฝั่งเรารอ 20 วิแล้วหมดเวลา) และ cold start เคยช้า 10-15 วิ
  // → งบเวลา 20 วิเท่าเดิม แต่แบ่งเป็น 2 รอบ รอบละ 10 วิ สำหรับคำสั่งอ่าน; คำสั่งเขียนรอ 20 วิรอบเดียว
  const attempts = IDEMPOTENT_ACTIONS.has(action) ? 2 : 1;
  const timeoutMs = attempts === 2 ? 10000 : 20000;
  let lastErr = '';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await callGasOnce<T>(webhookUrl, action, payload, timeoutMs);
    } catch (err) {
      lastErr = (err as Error).message;
      log.error('gas.call_failed', { action, attempt, err: lastErr });
    }
  }
  return { ok: false, error: lastErr };
}

// ---- Calendar actions (new — need adding to the Apps Script, see apps-script/) ----

export interface CalendarEventSummary {
  eventId: string;
  summary: string;
  description: string;
  start: string; // ISO
}

/** List events in a date range. Defaults to the CTT booking calendar — pass calendarId to read a different one (e.g. แชมป์'s AirAsia calendar). */
export function listCalendarEvents(fromIso: string, toIso: string, calendarId?: string): Promise<GasResponse<CalendarEventSummary[]>> {
  return callGas('calendar_list', { from: fromIso, to: toIso, calendarId });
}

// เผื่อ event บางอันไม่มีบรรทัด "Booking No:" ครบ (เจอจริง — VTL2937 leg 25 ก.ย. มีแค่โน้ตสั้นๆ
// ไม่มี "Booking No:" เลย) เช็คแพทเทิร์นอื่นที่บ่งบอกว่าเป็น booking จริงด้วย ทั้งใน title และ description
//
// ⚠️ "vtl"/"woa" ต้องตามด้วยตัวเลข (เลขอ้างอิงบุ๊คกิ้งจริง เช่น "VTL3055") ห้ามแมตช์คำเฉยๆ —
// เจอจริงว่า event ธุรการส่วนตัวของแชมป์ "ทำบิลเบิก WOA,VIAรายเดือน" (ไม่ใช่งานขับรถ) ถูกนับผิดว่า
// เป็น booking เพราะมีคำว่า "WOA" อยู่ในชื่อ event ทำให้ dispatch-match เสนอ/เตือนหาคนขับให้งานที่ไม่มีจริง
// ตัด "ctt" ออกจากรายการด้วย (เสี่ยงชนกับ event อื่นๆ ที่พูดถึงชื่อธุรกิจเฉยๆ ยิ่งกว่า woa/vtl อีก
// ไม่เคยมีบุ๊คกิ้งจริงใช้รหัส "CTT" นำหน้าเลย)
// งานที่ลูกค้าจองผ่านบอท LINE + จ่ายเงินเอง: ชื่อเดิมจาก Apps Script คือ "[CTT] จุดรับ → จุดส่ง | N Pax"
// (ไม่มี Booking No) และชื่อใหม่ขึ้นต้นด้วยรหัส "CTT-yymmdd-xxxx" — ต้องนับเป็น booking ให้ dispatch เห็น
// ใช้ ^ ผูกกับต้นชื่อ event เท่านั้น กันชนกับ event ธุรการที่แค่พูดถึงคำว่า CTT (ดูหมายเหตุด้านบน)
const BOOKING_PATTERNS: RegExp[] = [/booking no:/i, /\b(vtl|woa)\d+/i, /day trip/i, /^\[ctt\]/i, /^ctt-\d{6}-[a-z0-9]+/i];

/** ใช้เช็คว่า Calendar event นี้คือ "งานจริงที่ต้องมีคนขับ" ไม่ใช่ OFF/reminder/event อื่นที่อยู่ปฏิทินเดียวกัน */
export function isBookingEvent(ev: CalendarEventSummary): boolean {
  const haystack = `${ev.summary} ${ev.description}`;
  return BOOKING_PATTERNS.some((p) => p.test(haystack));
}

/** Append/replace the "Driver: ..." line in an event's description. */
export function updateCalendarEventDriver(eventId: string, driverLine: string | null): Promise<GasResponse<void>> {
  return callGas('calendar_update_driver', { eventId, driverLine });
}

// ---- Sheet actions (new — "CTT - Driver Roster & Dispatch") ----

export function sheetRead<T = Record<string, string>[]>(tab: string): Promise<GasResponse<T>> {
  return callGas('sheet_read', { tab });
}

export function sheetAppendRow(tab: string, row: Record<string, string>): Promise<GasResponse<void>> {
  return callGas('sheet_append', { tab, row });
}

export function sheetUpdateRow(
  tab: string,
  matchColumn: string,
  matchValue: string,
  patch: Record<string, string>
): Promise<GasResponse<void>> {
  return callGas('sheet_update', { tab, matchColumn, matchValue, patch });
}

/**
 * เขียนทับทั้งแท็บด้วยตาราง 2 มิติดิบๆ (สร้างแท็บใหม่ถ้ายังไม่มี) — ใช้สำหรับ
 * แท็บสรุปที่คนอ่าน เช่น ตารางแถว=คนขับ/คอลัมน์=วันที่ ไม่ใช่ข้อมูลที่ระบบอ่านกลับ
 *
 * `backgrounds` (ถ้ามี) ต้องมีมิติเท่า `values` เป๊ะๆ — แต่ละช่องเป็นสี CSS ชัดเจน (เช่น "#FFA500"
 * หรือ "#ffffff") ตั้งใจไม่ใช้ null เพราะ Apps Script's Range.setBackgrounds ไม่ document พฤติกรรม
 * null ไว้ชัดเจน ส่งสีขาวตรงๆ สำหรับช่องที่ไม่ต้องการไฮไลต์แทน กันเขียนพังทั้งกริด
 */
export function writeGrid(
  tab: string,
  values: (string | number)[][],
  backgrounds?: string[][]
): Promise<GasResponse<void>> {
  return callGas('sheet_write_grid', { tab, values, backgrounds });
}
