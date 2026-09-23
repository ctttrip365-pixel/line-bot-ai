// lib/job-availability.ts — per-job (not per-day) booking status for days that
// have 2+ open jobs, so the driver availability picker can let a driver pick a
// specific job instead of a whole day. Complements (doesn't replace) lib/day-status.ts,
// which stays in place for the leave picker + the human-readable Sheet grid, both of
// which only ever needed day-level granularity.
//
// Freshness matters more here than for day-status: the whole point is that once
// แชมป์ confirms a driver for a job, other drivers must immediately stop being able
// to pick that job. So this is cached with a short TTL (~60s) AND actively
// invalidated the moment a confirm/reassign happens (see app/api/telegram-webhook).

import { Redis } from '@upstash/redis';
import { listCalendarEvents, isBookingEvent } from './gas-client';
import { listAssignments } from './assignments';
import { listDrivers, findDriverById } from './drivers';
import { toBangkokParts } from './date-range';
import { log } from './log';

export interface JobEntry {
  eventId: string;
  date: string; // YYYY-MM-DD, Bangkok-correct
  startTime: string; // HH:MM, Bangkok-correct
  label: string; // currently == startTime, kept separate in case richer labels are wanted later
  confirmed: boolean;
  confirmedDriverName?: string;
}

function getRedis(): Redis {
  return new Redis({
    url: (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)!,
    token: (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)!,
  });
}

const CACHE_TTL_SECONDS = 60;

function cacheKey(month: string): string {
  return `job_map:${month}`;
}

export async function computeJobsForMonth(month: string): Promise<Record<string, JobEntry[]>> {
  const [y, m] = month.split('-').map(Number);
  const daysCount = new Date(y, m, 0).getDate();
  const fromIso = `${month}-01T00:00:00+07:00`;
  const toIso = `${month}-${String(daysCount).padStart(2, '0')}T23:59:59+07:00`;

  const [calRes, assignments, drivers] = await Promise.all([
    listCalendarEvents(fromIso, toIso),
    listAssignments(),
    listDrivers(),
  ]);

  const map: Record<string, JobEntry[]> = {};
  if (!calRes.ok || !calRes.data) {
    log.error('job_availability.calendar_read_failed', { month, error: calRes.error });
    return map;
  }

  for (const ev of calRes.data) {
    if (!isBookingEvent(ev)) continue; // ไม่ใช่ booking จริง (OFF/shift/reminder อื่นๆ ที่อยู่ปฏิทินเดียวกัน)

    const { date, time } = toBangkokParts(ev.start);
    const assignment = assignments.find((a) => a.booking_event_id === ev.eventId);
    // 'notified' คือ 'confirmed' เดิมที่ผ่านการแจ้งคนขับไปแล้ว (ดู lib/assignments.ts markNotified) — ยังนับว่ามีคนขับแล้วเหมือนกัน
    const confirmed = assignment?.status === 'confirmed' || assignment?.status === 'notified';
    const confirmedDriverName = confirmed
      ? findDriverById(drivers, assignment!.driver_id)?.display_name
      : undefined;

    const entry: JobEntry = { eventId: ev.eventId, date, startTime: time, label: time, confirmed, confirmedDriverName };
    (map[date] ??= []).push(entry);
  }

  for (const date of Object.keys(map)) {
    map[date].sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  return map;
}

export async function getJobsForMonth(month: string): Promise<Record<string, JobEntry[]>> {
  try {
    const cached = await getRedis().get<Record<string, JobEntry[]>>(cacheKey(month));
    if (cached) return cached;
  } catch (err) {
    log.error('job_availability.cache_read_failed', { month, err: (err as Error).message });
  }
  const map = await computeJobsForMonth(month);
  cacheJobsForMonth(month, map).catch(() => {});
  return map;
}

export async function cacheJobsForMonth(month: string, precomputed?: Record<string, JobEntry[]>): Promise<void> {
  const map = precomputed ?? (await computeJobsForMonth(month));
  try {
    await getRedis().set(cacheKey(month), map, { ex: CACHE_TTL_SECONDS });
  } catch (err) {
    log.error('job_availability.cache_write_failed', { month, err: (err as Error).message });
  }
}

/** เรียกทันทีหลัง confirmAssignment()/markNeedsReassignment() สำเร็จ — ปิดช่องโหว่ race condition หลัก */
export async function invalidateJobsCache(month: string): Promise<void> {
  try {
    await getRedis().del(cacheKey(month));
  } catch (err) {
    log.error('job_availability.cache_invalidate_failed', { month, err: (err as Error).message });
  }
}
