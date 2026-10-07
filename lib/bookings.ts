// lib/bookings.ts — เก็บรายละเอียดจองที่รอจ่ายเงินใน Redis (ผูกกับ client_reference_id ของ Stripe Payment Link)
// Payment Link เป็นลิงก์ตายตัวต่อเส้นทาง/ช่วงคน ใส่ข้อมูลจองลง metadata ไม่ได้
// เลยเก็บข้อมูลไว้ฝั่งเราด้วยรหัสอ้างอิง แล้ว Stripe webhook ใช้ client_reference_id มาค้นกลับ

import { randomBytes } from 'crypto';
import { getRedis } from './history';
import type { BookingDetails } from './calendar';
import { log } from './log';

const BOOKING_TTL_SECONDS = 14 * 24 * 60 * 60; // 14 วัน (Payment Link ไม่หมดอายุ ลูกค้าอาจกดจ่ายทีหลัง)
const SESSION_DONE_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface PendingBooking extends BookingDetails {
  amount: string;
  ref: string;
  paidSessionId?: string;
}

/** CTT-261007-K7M2 — ตัวอักษรที่ Stripe client_reference_id รับได้ (a-z 0-9 - _) */
export function newBookingRef(now = new Date()): string {
  const d = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: '2-digit', month: '2-digit', day: '2-digit' })
    .format(now)
    .split('/')
    .reverse()
    .join('');
  const rand = randomBytes(3).toString('hex').slice(0, 4).toUpperCase();
  return `CTT-${d}-${rand}`;
}

export async function savePendingBooking(booking: PendingBooking): Promise<void> {
  await getRedis().set(`booking:${booking.ref}`, booking, { ex: BOOKING_TTL_SECONDS });
}

export async function getPendingBooking(ref: string): Promise<PendingBooking | null> {
  try {
    return (await getRedis().get<PendingBooking>(`booking:${ref}`)) ?? null;
  } catch (err) {
    log.error('bookings.get_failed', { ref, err: (err as Error).message });
    return null;
  }
}

export async function markBookingPaid(booking: PendingBooking, sessionId: string): Promise<void> {
  try {
    await getRedis().set(`booking:${booking.ref}`, { ...booking, paidSessionId: sessionId }, { ex: BOOKING_TTL_SECONDS });
  } catch (err) {
    log.error('bookings.mark_paid_failed', { ref: booking.ref, err: (err as Error).message });
  }
}

/** Stripe อาจส่ง webhook เดิมซ้ำ — คืน true เฉพาะครั้งแรกที่เห็น session นี้ (Redis ล่ม = ปล่อยผ่าน ดีกว่าไม่ลงงาน) */
export async function claimStripeSession(sessionId: string): Promise<boolean> {
  try {
    const res = await getRedis().set(`stripe_session_done:${sessionId}`, '1', { nx: true, ex: SESSION_DONE_TTL_SECONDS });
    return res !== null;
  } catch (err) {
    log.error('bookings.claim_failed', { sessionId, err: (err as Error).message });
    return true;
  }
}
