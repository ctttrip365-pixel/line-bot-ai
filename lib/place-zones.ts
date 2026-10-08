// lib/place-zones.ts — บอทจำ "ชื่อโรงแรม/สถานที่ → ย่าน (zone ในชีตราคา)" จากแชทลูกค้า เพื่อไม่ต้องถามย่านซ้ำครั้งหน้า
//
// กติกา (แชมป์สั่ง 8 ต.ค. 2026): ลูกค้า 1 คนบอกย่าน → บันทึกและใช้ราคาย่านนั้นทันที (รวมย่านที่ Gemini เดาเองเมื่อมั่นใจ)
// แล้วสรุปรายการใหม่ส่ง Telegram ตอน ~09:00 (พ่วง cron เดิม /api/dispatch/refresh-day-status) ให้แชมป์ตรวจ — ผิดก็กด ❌ ลบ
// เก็บใน Redis hash `placezone:v1` เก็บเฉพาะ ชื่อสถานที่ + ย่าน + จำนวนครั้ง ไม่เก็บข้อมูลลูกค้า
// เป็นตัวสำรองระหว่างที่แชมป์ยังไม่ได้เติมแท็บ `Aliases` ในชีตราคา (ชีตมาก่อนเสมอ)

import { createHash } from 'crypto';
import { getRedis } from './history';
import { norm } from './text-norm';
import { sendTelegramMessage } from './telegram';
import { log } from './log';

const KEY = 'placezone:v1';
const MAX_DIGEST = 25; // ส่งสูงสุดต่อรอบ (ปุ่ม Telegram + ข้อความไม่เกินลิมิต) ที่เหลือยกไปวันถัดไป

export type PlaceSource = 'customer' | 'gemini';

export interface LearnedPlace {
  id: string;
  name: string;
  zone: string;
  source: PlaceSource;
  count: number;
  firstSeen: string;
  lastSeen: string;
  status: 'active' | 'rejected';
  notified: boolean;
  conflictZone?: string; // ลูกค้าคนล่าสุดบอกย่านต่างจากที่จำไว้ (ไม่เปลี่ยนเอง รอแชมป์ตัดสิน)
}

const placeId = (name: string) => createHash('sha1').update(norm(name)).digest('hex').slice(0, 8);
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const now = () => new Date().toISOString();

type RedisLike = Pick<ReturnType<typeof getRedis>, 'hget' | 'hset' | 'hgetall'>;

/** รายการ alias ที่เรียนรู้ไว้ (เฉพาะที่ยังใช้งานอยู่) ใช้ต่อท้าย alias ของชีตตอนโหลดราคา — Redis ล่ม = ไม่มี ไม่ทำให้การคิดราคาล้ม */
export async function loadLearnedAliases(redis: RedisLike = getRedis()): Promise<Array<[string, string]>> {
  try {
    const all = (await redis.hgetall<Record<string, LearnedPlace>>(KEY)) ?? {};
    return Object.values(all)
      .filter((p) => p && p.status === 'active' && p.name && p.zone)
      .map((p) => [p.name, p.zone] as [string, string]);
  } catch (err) {
    log.warn('place_zones.load_failed', { err: (err as Error).message });
    return [];
  }
}

/** บันทึกว่า "ชื่อสถานที่นี้ อยู่ย่านนี้" จากแชท — เรียกเมื่อ lookup_price สำเร็จด้วยชื่อย่านแทนสถานที่ที่ระบบยังไม่รู้จัก */
export async function recordPlaceZone(
  name: string,
  zone: string,
  source: PlaceSource,
  redis: RedisLike = getRedis()
): Promise<'new' | 'seen' | 'conflict' | 'ignored'> {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (clean.length < 3 || clean.length > 80 || !zone) return 'ignored';
  const id = placeId(clean);
  try {
    const cur = await redis.hget<LearnedPlace>(KEY, id);
    if (!cur) {
      const rec: LearnedPlace = { id, name: clean, zone, source, count: 1, firstSeen: now(), lastSeen: now(), status: 'active', notified: false };
      await redis.hset(KEY, { [id]: rec });
      log.info('place_zones.learned', { id, zone, source });
      return 'new';
    }
    if (cur.status === 'rejected') {
      if (cur.zone === zone) return 'ignored'; // แชมป์ปัดตกย่านนี้ไปแล้ว ไม่เรียนรู้ซ้ำ
      const rec: LearnedPlace = { ...cur, zone, source, count: 1, lastSeen: now(), status: 'active', notified: false, conflictZone: undefined };
      await redis.hset(KEY, { [id]: rec });
      return 'new';
    }
    if (cur.zone === zone) {
      await redis.hset(KEY, { [id]: { ...cur, count: cur.count + 1, lastSeen: now(), source: cur.source === 'customer' || source === 'customer' ? 'customer' : 'gemini' } });
      return 'seen';
    }
    // ย่านขัดกับที่จำไว้ → ไม่เปลี่ยนเอง แจ้งแชมป์ตอน 09:00
    await redis.hset(KEY, { [id]: { ...cur, conflictZone: zone, notified: false, lastSeen: now() } });
    log.warn('place_zones.conflict', { id, zone, was: cur.zone });
    return 'conflict';
  } catch (err) {
    log.warn('place_zones.record_failed', { err: (err as Error).message });
    return 'ignored';
  }
}

async function readAll(redis: RedisLike): Promise<LearnedPlace[]> {
  const all = (await redis.hgetall<Record<string, LearnedPlace>>(KEY)) ?? {};
  return Object.values(all).filter((p) => p && p.id);
}

export async function rejectPlace(id: string, redis: RedisLike = getRedis()): Promise<LearnedPlace | null> {
  const cur = await redis.hget<LearnedPlace>(KEY, id);
  if (!cur) return null;
  const rec: LearnedPlace = { ...cur, status: 'rejected', notified: true, conflictZone: undefined };
  await redis.hset(KEY, { [id]: rec });
  return rec;
}

/** แชมป์เลือกใช้ย่านใหม่ที่ลูกค้าบอก (กรณีขัดแย้ง) */
export async function adoptConflictZone(id: string, redis: RedisLike = getRedis()): Promise<LearnedPlace | null> {
  const cur = await redis.hget<LearnedPlace>(KEY, id);
  if (!cur?.conflictZone) return null;
  const rec: LearnedPlace = { ...cur, zone: cur.conflictZone, conflictZone: undefined, notified: true, count: 1 };
  await redis.hset(KEY, { [id]: rec });
  return rec;
}

// ชื่อย่านที่แสดงให้แชมป์ (ไทย) — import แบบ lazy กัน circular กับ prices.ts
async function zoneThai(zone: string): Promise<string> {
  const { zoneLabelTh } = await import('./prices');
  return zoneLabelTh(zone);
}

/** สรุปโรงแรม/สถานที่ที่เพิ่งเรียนรู้ (และที่ขัดแย้ง) ส่งเข้า Telegram — เรียกจาก cron ~09:00 ไทย */
export async function alertNewPlaceZones(redis: RedisLike = getRedis()): Promise<{ sent: boolean; count: number }> {
  const pending = (await readAll(redis))
    .filter((p) => p.status === 'active' && !p.notified)
    .sort((a, b) => a.firstSeen.localeCompare(b.firstSeen))
    .slice(0, MAX_DIGEST);
  if (pending.length === 0) return { sent: false, count: 0 };

  const lines: string[] = [];
  const buttons: Array<Array<{ text: string; callback_data: string }>> = [];
  const csv: string[] = [];
  for (const p of pending) {
    const zt = await zoneThai(p.zone);
    if (p.conflictZone) {
      const ct = await zoneThai(p.conflictZone);
      lines.push(`⚠️ <b>${esc(p.name)}</b> — จำไว้ว่า ${esc(zt)} แต่ลูกค้าล่าสุดบอก ${esc(ct)}`);
      buttons.push([
        { text: `ใช้ ${ct} : ${p.name}`.slice(0, 60), callback_data: `pz_use:${p.id}` },
        { text: `❌ ลบ`, callback_data: `pz_rej:${p.id}` },
      ]);
    } else {
      const src = p.source === 'customer' ? 'ลูกค้าบอก' : '🤖 Gemini เดา — ตรวจให้ดี';
      lines.push(`• <b>${esc(p.name)}</b> → ${esc(zt)} (${src}${p.count > 1 ? ` ×${p.count}` : ''})`);
      buttons.push([{ text: `❌ ไม่ใช่ย่านนี้ : ${p.name}`.slice(0, 60), callback_data: `pz_rej:${p.id}` }]);
      csv.push(`${p.name.replace(/,/g, ' ')},${p.zone}`);
    }
  }
  const text = [
    `🏨 <b>บอทจำสถานที่เข้าย่านใหม่ (${pending.length})</b> — ใช้ราคาย่านนั้นแล้ว ถ้าผิดกด ❌`,
    '',
    ...lines,
    ...(csv.length ? ['', 'แถวสำหรับแปะแท็บ Aliases ในชีตราคา (name,zone):', `<code>${esc(csv.join('\n'))}</code>`] : []),
  ].join('\n');

  await sendTelegramMessage(text, buttons);
  // ถือว่าแจ้งแล้ว (ไม่แจ้งซ้ำพรุ่งนี้) — ถ้าส่งไม่สำเร็จ sendTelegramMessage จะ log error เอง
  for (const p of pending) await redis.hset(KEY, { [p.id]: { ...p, notified: true } });
  log.info('place_zones.digest_sent', { count: pending.length });
  return { sent: true, count: pending.length };
}
