// lib/drivers.ts — "Drivers" tab: driver_id, display_name, line_user_id, phone,
// license_class, license_expiry, active, role (owner/driver), joined_date, notes
//
// Adding a driver = adding a row in the Sheet. No code change needed.

import { after } from 'next/server';
import { sheetRead } from './gas-client';
import { getRedis } from './history';
import { log } from './log';

export interface Driver {
  driver_id: string;
  display_name: string;
  line_user_id: string;
  phone: string;
  license_class: string;
  license_expiry: string;
  active: string; // "TRUE" / "FALSE" as stored in the Sheet
  role: 'owner' | 'driver';
  joined_date: string;
  notes: string;
}

// Driver roster changes rarely (Champ adds a row by hand occasionally).
//
// 2026-10-07: ระบบเคยเข้าใจแชมป์ (คนขับ) เป็น "ลูกค้า" เพราะ Apps Script ตื่นช้าเกิน 20 วินาที (cold start)
// → อ่านรายชื่อไม่ได้ → รายชื่อว่าง → ข้อความ "วันว่าง" ไปเข้า Gemini ฝั่งลูกค้า (และลูกค้าทุกคนต้องรอเช็คนี้ด้วย)
// แก้โดยเก็บสำเนารายชื่อใน Redis แล้วใช้แบบ stale-while-revalidate:
//   1) memory cache (5 นาที)  2) Redis (สดภายใน 5 นาที = ใช้เลย; เก่ากว่านั้น = ใช้ทันที + รีเฟรชจาก Sheet เบื้องหลัง)
//   3) ไม่มีทั้งสองที่ = อ่านจาก Sheet ตรงๆ (เหมือนเดิม)  4) ล้มเหลวหมด = รายชื่อว่าง + ตั้งธง rosterUnavailable
// สำเนาใน Redis ตัดข้อมูลส่วนตัวที่ไม่ได้ใช้ออก (เลขใบขับขี่/หมายเหตุ/วันหมดอายุ) ตามหลัก PDPA

const MEM_TTL_MS = 5 * 60_000;
const REDIS_FRESH_MS = 5 * 60_000;
const REDIS_KEY = 'drivers:roster:v1';
const REDIS_TTL_SECONDS = 30 * 24 * 60 * 60;

let cache: { at: number; drivers: Driver[] } | null = null;
let refreshing = false;
let lastLoadFailed = false;

/** true = รอบล่าสุดอ่านรายชื่อคนขับไม่ได้เลย (ไม่มีสำเนา) — ผู้เรียกอย่าสรุปว่า "ไม่ใช่คนขับ" แบบเงียบๆ */
export function driverRosterUnavailable(): boolean {
  return lastLoadFailed;
}

function slim(d: Driver): Driver {
  return { ...d, license_class: '', license_expiry: '', notes: '', joined_date: '' };
}

async function loadFromSheet(): Promise<Driver[] | null> {
  const res = await sheetRead<Driver[]>('Drivers');
  if (!res.ok || !res.data) {
    log.error('drivers.read_failed', { error: res.error });
    return null;
  }
  return res.data;
}

async function refreshRoster(): Promise<Driver[] | null> {
  const drivers = await loadFromSheet();
  if (!drivers) return null;
  cache = { at: Date.now(), drivers };
  lastLoadFailed = false;
  try {
    await getRedis().set(REDIS_KEY, { at: Date.now(), drivers: drivers.map(slim) }, { ex: REDIS_TTL_SECONDS });
  } catch (err) {
    log.warn('drivers.redis_save_failed', { err: (err as Error).message });
  }
  return drivers;
}

async function loadFromRedis(): Promise<{ at: number; drivers: Driver[] } | null> {
  try {
    return (await getRedis().get<{ at: number; drivers: Driver[] }>(REDIS_KEY)) ?? null;
  } catch (err) {
    log.warn('drivers.redis_read_failed', { err: (err as Error).message });
    return null;
  }
}

export async function listDrivers(forceRefresh = false): Promise<Driver[]> {
  if (!forceRefresh && cache && Date.now() - cache.at < MEM_TTL_MS) return cache.drivers;

  if (forceRefresh) {
    // ต้องการข้อมูลสดจริง (เช่น สร้างตารางวันว่าง) — ลองอ่านจาก Sheet ก่อน ไม่ได้ค่อยใช้สำเนา
    const fresh = await refreshRoster();
    if (fresh) return fresh;
  } else {
    const copy = await loadFromRedis();
    if (copy && Array.isArray(copy.drivers) && copy.drivers.length > 0) {
      cache = { at: copy.at, drivers: copy.drivers };
      lastLoadFailed = false;
      if (Date.now() - copy.at < REDIS_FRESH_MS) return copy.drivers;
      // สำเนาเริ่มเก่า: ใช้ทันที แล้วรีเฟรชจาก Sheet เบื้องหลัง (ไม่ให้ข้อความนี้ต้องรอ Apps Script)
      if (!refreshing) {
        refreshing = true;
        try {
          after(() => refreshRoster().catch(() => null).finally(() => { refreshing = false; }));
        } catch {
          // ไม่ได้อยู่ใน request (เช่น สคริปต์) — รีเฟรชแบบรอผล
          const fresh = await refreshRoster();
          refreshing = false;
          if (fresh) return fresh;
        }
      }
      return copy.drivers;
    }
    const fresh = await refreshRoster(); // ไม่มีสำเนา (ครั้งแรก) — อ่านจาก Sheet ตรงๆ
    if (fresh) return fresh;
  }

  // ทุกทางล้มเหลว: ใช้ memory เก่าถ้ามี (fail-open ต่อการ route ผิดเป็นความเสี่ยงต่ำ) ไม่งั้นรายชื่อว่าง
  if (cache) return cache.drivers;
  lastLoadFailed = true;
  return [];
}

/** Used by the LINE webhook to decide: this sender is a driver, not a customer. */
export async function findDriverByLineId(lineUserId: string): Promise<Driver | null> {
  const drivers = await listDrivers();
  return (
    drivers.find(
      (d) => d.line_user_id === lineUserId && String(d.active).toUpperCase() === 'TRUE'
    ) ?? null
  );
}

export function findDriverById(drivers: Driver[], driverId: string): Driver | undefined {
  return drivers.find((d) => d.driver_id === driverId);
}
