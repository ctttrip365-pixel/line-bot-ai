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

async function callGas<T = unknown>(action: string, payload: Record<string, unknown>): Promise<GasResponse<T>> {
  const webhookUrl = process.env.CALENDAR_WEBHOOK_URL;
  if (!webhookUrl) {
    log.error('gas.no_webhook_url', { action });
    return { ok: false, error: 'CALENDAR_WEBHOOK_URL not set' };
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
      // Apps Script web apps have real cold-start latency (observed 10-15s for
      // a plain Sheet read) — 8s was too aggressive and made every driver-check
      // time out, silently falling everyone through to the Gemini/customer path.
      // 20s leaves headroom above the worst case we've seen while still leaving
      // the Gemini call room inside the 30s function budget on a cache miss.
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      log.error('gas.http_error', { action, status: res.status });
      return { ok: false, error: `HTTP ${res.status}` };
    }

    const json = (await res.json()) as GasResponse<T>;
    log.info('gas.call_ok', { action, ok: json.ok });
    return json;
  } catch (err) {
    log.error('gas.call_failed', { action, err: (err as Error).message });
    return { ok: false, error: (err as Error).message };
  }
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
 */
export function writeGrid(tab: string, values: (string | number)[][]): Promise<GasResponse<void>> {
  return callGas('sheet_write_grid', { tab, values });
}
