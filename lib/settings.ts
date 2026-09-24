// lib/settings.ts — tiny key/value "Settings" tab in "CTT - Driver Roster & Dispatch",
// so แชมป์ can flip switches by editing a cell in the Sheet he already has open, instead
// of touching env vars/redeploys. Currently just one switch (auto-dispatch pause) but the
// key/value shape leaves room for more without a schema change.

import { sheetRead } from './gas-client';
import { log } from './log';

const SETTINGS_TAB = 'Settings';
const AUTO_MATCH_KEY = 'auto_dispatch_enabled';

interface SettingsRow {
  key: string;
  value: string;
}

/**
 * แชมป์พิมพ์ FALSE ในช่อง value ของแถว "auto_dispatch_enabled" เพื่อพักการจับคู่คนขับอัตโนมัติ
 * ชั่วคราว (ทั้ง instant trigger หลังส่งวันว่าง และ cron 30 นาที) — ใช้ตอนอยากคุมเองผ่าน "จัดคนขับเอง"
 * ใน Telegram ล้วนๆ ก่อน ไม่กระทบฟังก์ชันอื่น (ส่งวันว่าง/เช็คงาน/แจ้งเตือนพรุ่งนี้ยังทำงานปกติ)
 *
 * fail-open โดยตั้งใจ — ถ้าแท็บยังไม่มี/อ่านไม่ได้/ยังไม่เคยตั้งค่า ให้ถือว่า "เปิด" (พฤติกรรมเดิม
 * ก่อนมีสวิตช์นี้) ไม่ให้ปัญหาการอ่าน Sheet มาบล็อกการจับคู่งานจริงโดยไม่ตั้งใจ
 */
export async function isDispatchAutoMatchEnabled(): Promise<boolean> {
  const res = await sheetRead<SettingsRow[]>(SETTINGS_TAB);
  if (!res.ok || !res.data) {
    log.warn('settings.read_failed_failing_open', { error: res.ok ? undefined : res.error });
    return true;
  }
  const row = res.data.find((r) => r.key === AUTO_MATCH_KEY);
  if (!row) return true;
  return String(row.value).trim().toUpperCase() !== 'FALSE';
}
