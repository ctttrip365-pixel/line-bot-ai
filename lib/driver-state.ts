// lib/driver-state.ts — short-lived Redis state for multi-step driver LINE flows
// (picking several days before "submit", or typing a leave reason after picking a
// date). Same Upstash Redis instance lib/history.ts already uses, separate keyspace.

import { Redis } from '@upstash/redis';
import { log } from './log';

function getRedis(): Redis {
  return new Redis({
    url: (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)!,
    token: (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)!,
  });
}

const STATE_TTL_SECONDS = 24 * 60 * 60; // ให้เวลากรอกทั้งเดือนพอสมควรแต่ไม่ค้างถาวรถ้าทำครึ่งๆ กลาง

// เก็บ selection ต่อคนขับตัวเดียว (ไม่แยกตามเดือน) เพราะตัวปฏิทินตอนนี้เป็น rolling
// window "วันนี้ → สิ้นเดือนหน้า" ที่คร่อม 2 เดือนปฏิทินได้ในเซสชันเดียว — ดู lib/date-range.ts

export async function toggleAvailabilityDate(driverId: string, date: string): Promise<string[]> {
  const key = `avail_sel:${driverId}`;
  try {
    const current = (await getRedis().get<string[]>(key)) ?? [];
    const next = current.includes(date) ? current.filter((d) => d !== date) : [...current, date];
    await getRedis().set(key, next, { ex: STATE_TTL_SECONDS });
    return next;
  } catch (err) {
    log.error('driver_state.toggle_failed', { err: (err as Error).message });
    return [];
  }
}

export async function getSelectedDates(driverId: string): Promise<string[]> {
  try {
    return (await getRedis().get<string[]>(`avail_sel:${driverId}`)) ?? [];
  } catch {
    return [];
  }
}

export async function clearSelectedDates(driverId: string): Promise<void> {
  try {
    await getRedis().del(`avail_sel:${driverId}`);
  } catch (err) {
    log.error('driver_state.clear_failed', { err: (err as Error).message });
  }
}

/** ระหว่างขอลา: เก็บวันที่เลือกไว้ รอคนขับพิมพ์เหตุผลเป็นข้อความถัดไป */
export async function setPendingLeaveDate(driverId: string, date: string): Promise<void> {
  try {
    await getRedis().set(`leave_pending:${driverId}`, date, { ex: 30 * 60 });
  } catch (err) {
    log.error('driver_state.set_pending_leave_failed', { err: (err as Error).message });
  }
}

export async function popPendingLeaveDate(driverId: string): Promise<string | null> {
  try {
    const date = await getRedis().get<string>(`leave_pending:${driverId}`);
    if (date) await getRedis().del(`leave_pending:${driverId}`);
    return date;
  } catch {
    return null;
  }
}
