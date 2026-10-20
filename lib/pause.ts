// lib/pause.ts — พักบอทรายลูกค้า: แชมป์เข้ามาตอบแชทเอง → บอทหยุดตอบลูกค้าคนนั้นชั่วคราว
//
// LINE ไม่ส่ง webhook เมื่อแชมป์พิมพ์ตอบใน LINE OA Manager (บอทมองไม่เห็นข้อความแชมป์เลย)
// จึงให้แชมป์สั่งพักเองด้วยปุ่ม "⏸ พักบอท" ใน Telegram (แนบกับข้อความแจ้งเตือนลูกค้าทุกอัน)
// เก็บใน Redis ด้วย TTL — หมดเวลาแล้วบอทกลับมาตอบเองโดยไม่ต้องทำอะไร
//
// ล้มเหลวแบบ fail-open: อ่าน Redis ไม่ได้ = ถือว่าไม่ได้พัก (บอทตอบตามเดิม ดีกว่าลูกค้าถูกเมินเงียบๆ)

import { getRedis } from './history';
import { log } from './log';

export const PAUSE_MINUTES = 30;

const key = (userId: string) => `botpause:${userId}`;

/** พักบอทของลูกค้าคนนี้ — คืนเวลาสิ้นสุด (epoch ms); Redis ล้ม = คืน null */
export async function pauseBot(userId: string, minutes: number = PAUSE_MINUTES): Promise<number | null> {
  const until = Date.now() + minutes * 60_000;
  try {
    await getRedis().set(key(userId), String(until), { ex: minutes * 60 });
    log.info('bot_pause.set', { userId, minutes });
    return until;
  } catch (err) {
    log.error('bot_pause.set_failed', { userId, err: (err as Error).message });
    return null;
  }
}

export async function resumeBot(userId: string): Promise<void> {
  try {
    await getRedis().del(key(userId));
    log.info('bot_pause.cleared', { userId });
  } catch (err) {
    log.error('bot_pause.clear_failed', { userId, err: (err as Error).message });
  }
}

export async function isBotPaused(userId: string): Promise<boolean> {
  try {
    return (await getRedis().get(key(userId))) !== null;
  } catch (err) {
    log.error('bot_pause.check_failed', { userId, err: (err as Error).message });
    return false;
  }
}

/** HH:MM เวลาไทย (+07) ไว้บอกแชมป์ว่าบอทจะกลับมาตอบตอนไหน */
export function formatPauseEnd(untilMs: number): string {
  return new Intl.DateTimeFormat('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Bangkok',
  }).format(new Date(untilMs));
}

/** callback_data ของปุ่ม Telegram (จำกัด 64 ไบต์) — userId ของ LINE ยาว 33 ตัวอักษร */
export function pauseCallbackData(userId: string): string | null {
  const d = `pause:${userId}`;
  return /^U[0-9a-f]{32}$/.test(userId) && d.length <= 64 ? d : null;
}
