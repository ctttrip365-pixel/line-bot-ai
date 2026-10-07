// lib/unassigned-alert.ts — สรุปงานที่ "ยังไม่มีคนขับ" และใกล้ถึงวันขับ แจ้งแชมป์ใน Telegram ครั้งเดียวต่อวัน (~09:00 เวลาไทย)
// แชมป์สั่ง 2026-10-07: งานที่ยังหาคนขับไม่ได้ ไม่ต้องแจ้งอัตโนมัติทันที — แจ้งเมื่อเหลือไม่เกิน 2 วัน
// รันจาก cron รายวัน /api/dispatch/refresh-day-status (ย้ายเป็น 02:00 UTC = 09:00 ไทย; Vercel Hobby จำกัดจำนวน cron จึงพ่วงในตัวเดิม)

import { listCalendarEvents, isBookingEvent } from './gas-client';
import { listAssignments } from './assignments';
import { toBangkokParts } from './date-range';
import { sendTelegramMessage } from './telegram';
import { getRedis } from './history';
import { log } from './log';

export const UNASSIGNED_ALERT_DAYS = 2;

function bangkokToday(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const DAY_WORD = ['วันนี้', 'พรุ่งนี้', 'อีก 2 วัน'];
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function alertUnassignedSoon(): Promise<{ sent: boolean; count: number }> {
  const today = bangkokToday();
  const last = addDays(today, UNASSIGNED_ALERT_DAYS);

  // กันส่งซ้ำถ้า cron ถูกยิงซ้ำในวันเดียวกัน
  try {
    const first = await getRedis().set(`unassigned_alert_sent:${today}`, '1', { nx: true, ex: 20 * 3600 });
    if (first === null) return { sent: false, count: 0 };
  } catch (err) {
    log.warn('unassigned_alert.dedupe_failed', { err: (err as Error).message });
  }

  const [cal, assignments] = await Promise.all([
    listCalendarEvents(`${today}T00:00:00+07:00`, `${last}T23:59:59+07:00`),
    listAssignments(),
  ]);
  if (!cal.ok || !cal.data) {
    log.error('unassigned_alert.calendar_failed', { error: cal.error });
    return { sent: false, count: 0 };
  }

  const latest = new Map<string, string>();
  for (const a of assignments) latest.set(a.booking_event_id, a.status);

  const nowMs = Date.now();
  const jobs = cal.data
    .filter(isBookingEvent)
    .map((ev) => ({ ev, ...toBangkokParts(ev.start) }))
    .filter(({ ev, date, time }) => {
      const status = latest.get(ev.eventId);
      if (status === 'confirmed' || status === 'notified') return false; // มีคนขับแล้ว
      if (/^Driver:/m.test(ev.description || '')) return false; // ลงชื่อคนขับในปฏิทินเอง
      // วันนี้: ข้ามงานที่เลยเวลาไปแล้ว
      return new Date(`${date}T${time}:00+07:00`).getTime() >= nowMs - 30 * 60000;
    })
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  if (jobs.length === 0) return { sent: false, count: 0 };

  const dayIndex = (d: string) => Math.round((new Date(`${d}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000);
  const lines = jobs.map(({ ev, date, time }) => `• ${DAY_WORD[dayIndex(date)] ?? date} ${date} ${time} — ${esc(ev.summary.split('|').slice(0, 3).join('|').trim())}`);

  await sendTelegramMessage(
    [`⚠️ <b>งานใกล้ถึงวันแล้ว แต่ยังไม่มีคนขับ (${jobs.length} งาน)</b>`, '', ...lines, '', 'กดปุ่มเพื่อจัดคนขับเอง'].join('\n'),
    jobs.map(({ ev, date, time }) => [{ text: `👤 จัดคนขับ ${date.slice(5)} ${time}`, callback_data: `reassign:${ev.eventId}` }])
  );
  log.info('unassigned_alert.sent', { count: jobs.length });
  return { sent: true, count: jobs.length };
}
