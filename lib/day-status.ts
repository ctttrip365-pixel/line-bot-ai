// lib/day-status.ts — per-day booking status shown on the availability/leave
// pickers ("ว่าง" / "ไม่มีงาน" / "มีคนขับ"). Recomputed once a day by a Vercel
// Cron (see app/api/dispatch/refresh-day-status) and cached in Redis — Champ
// confirmed this doesn't need to be real-time, so pickers always read the
// cheap cached copy instead of hitting Calendar/Sheets on every message.

import { Redis } from '@upstash/redis';
import { listCalendarEvents } from './gas-client';
import { listAssignments } from './assignments';
import { toBangkokParts } from './date-range';
import { log } from './log';

export type DayStatus = 'ว่าง' | 'ไม่มีงาน' | 'มีคนขับ';

function getRedis(): Redis {
  return new Redis({
    url: (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)!,
    token: (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)!,
  });
}

const CACHE_TTL_SECONDS = 26 * 60 * 60; // ~1 วัน + กันชนเผื่อ cron รันช้า

function cacheKey(month: string): string {
  return `day_status:${month}`;
}

/**
 * อ่านจาก cache ก่อนเสมอ (เร็ว) — ถ้ายังไม่เคยมี (เช่น deploy ใหม่ ยังไม่ถึงรอบ cron)
 * คำนวณสดครั้งแรกแล้วเซฟลง cache ทันที กันไม่ให้ request ถัดๆ ไปต้องคำนวณสดซ้ำจนกว่าจะถึงรอบ cron
 */
export async function getDayStatusMap(month: string): Promise<Record<string, DayStatus>> {
  try {
    const cached = await getRedis().get<Record<string, DayStatus>>(cacheKey(month));
    if (cached) return cached;
  } catch (err) {
    log.error('day_status.cache_read_failed', { month, err: (err as Error).message });
  }
  const map = await computeDayStatusMap(month);
  cacheDayStatusMap(month, map).catch(() => {});
  return map;
}

export async function computeDayStatusMap(month: string): Promise<Record<string, DayStatus>> {
  const [y, m] = month.split('-').map(Number);
  const daysCount = new Date(y, m, 0).getDate();
  const fromIso = `${month}-01T00:00:00+07:00`;
  const toIso = `${month}-${String(daysCount).padStart(2, '0')}T23:59:59+07:00`;

  const [calRes, assignments] = await Promise.all([listCalendarEvents(fromIso, toIso), listAssignments()]);

  // "มี booking จริง" ตัดสินจาก description มี "Booking No:" (field ที่ ctt-booking เขียนไว้เสมอ)
  // กันไม่ให้ all-day OFF/กะ AirAsia ที่อยู่ใน calendar เดียวกันถูกนับเป็น booking
  const bookingDates = new Set<string>();
  if (calRes.ok && calRes.data) {
    for (const ev of calRes.data) {
      if (ev.description?.includes('Booking No:')) {
        // ห้ามใช้ ev.start.slice(0, 10) ตรงๆ — ev.start เป็น UTC ISO เสมอ (มาจาก Apps Script's
        // ev.getStartTime().toISOString()) งานที่เริ่มก่อน 07:00 น. เวลาไทยจะตกไปนับเป็นวันก่อนหน้า
        bookingDates.add(toBangkokParts(ev.start).date);
      }
    }
  } else {
    log.error('day_status.calendar_read_failed', { month, error: calRes.error });
  }

  // 'notified' คือ 'confirmed' เดิมที่ผ่านการแจ้งคนขับไปแล้ว (ดู markNotified) — ยังนับว่ามีคนขับแล้วเหมือนกัน
  // ไม่งั้นวันที่แจ้งเตือนคนขับไปแล้วจะโชว์ผิดว่า "ว่าง" อีกครั้งพอ cron รอบถัดไปคำนวณใหม่
  const confirmedDates = new Set(
    assignments.filter((a) => a.status === 'confirmed' || a.status === 'notified').map((a) => a.job_date)
  );

  const map: Record<string, DayStatus> = {};
  for (let d = 1; d <= daysCount; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    if (!bookingDates.has(date)) map[date] = 'ไม่มีงาน';
    else if (confirmedDates.has(date)) map[date] = 'มีคนขับ';
    else map[date] = 'ว่าง';
  }
  return map;
}

export async function cacheDayStatusMap(month: string, precomputed?: Record<string, DayStatus>): Promise<void> {
  const map = precomputed ?? (await computeDayStatusMap(month));
  try {
    await getRedis().set(cacheKey(month), map, { ex: CACHE_TTL_SECONDS });
    log.info('day_status.cached', { month });
  } catch (err) {
    log.error('day_status.cache_write_failed', { month, err: (err as Error).message });
  }
}
