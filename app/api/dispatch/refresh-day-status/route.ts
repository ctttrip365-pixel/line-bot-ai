// app/api/dispatch/refresh-day-status/route.ts — Vercel Cron target, once daily
// (see vercel.json). Recomputes the "ว่าง/ไม่มีงาน/มีคนขับ" status shown on the
// driver availability/leave pickers for this month + next month, caches it in
// Redis, and also rewrites the human-readable "แถว=คนขับ/คอลัมน์=วันที่" grid tab
// แชมป์ reads directly in the Sheet — piggybacking both jobs on one daily cron
// instead of adding a third (Vercel Hobby caps how many crons a project gets).

import { cacheDayStatusMap } from '@/lib/day-status';
import { buildAndWriteMonthGrid } from '@/lib/driver-grid';
import { alertUnassignedSoon } from '@/lib/unassigned-alert';
import { alertNewPlaceZones } from '@/lib/place-zones';
import { sendSideJobConfirmations, sendMonthlySummariesIfFirstDay } from '@/lib/sidejob-daily';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
// เพิ่มขั้นสมุดบัญชีงานที่ขับให้เพื่อน (อ่านชีต + ส่ง Telegram หลายข้อความ) — Apps Script เคย cold start 10-15 วิ
export const maxDuration = 60;

function currentAndNextMonth(): string[] {
  const now = new Date();
  const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextStr = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
  return [cur, nextStr];
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('unauthorized', { status: 401 });
  }

  const months = currentAndNextMonth();
  for (const month of months) {
    await cacheDayStatusMap(month);
    await buildAndWriteMonthGrid(month);
  }

  // ตัวเดียวกันนี้รันเวลา ~09:00 ไทย → สรุปงานที่ยังไม่มีคนขับและเหลือไม่เกิน 2 วัน (ไม่ทำให้การรีเฟรชข้างบนล้มถ้าขั้นนี้พัง)
  let alert: { sent: boolean; count: number } | null = null;
  try {
    alert = await alertUnassignedSoon();
  } catch (err) {
    log.error('unassigned_alert.failed', { err: (err as Error).message });
  }

  // ตัวเดียวกัน: สรุปโรงแรม/สถานที่ที่บอทเพิ่งจำเข้าย่านจากแชทลูกค้า ให้แชมป์ตรวจใน Telegram (ผิดกด ❌)
  let places: { sent: boolean; count: number } | null = null;
  try {
    places = await alertNewPlaceZones();
  } catch (err) {
    log.error('place_zones.digest_failed', { err: (err as Error).message });
  }

  // ตัวเดียวกัน: ถามงานที่ขับให้เพื่อนซึ่งผ่านวันงานแล้ว "ขับจริงไหม/มีค่าใช้จ่ายเพิ่มไหม" (ปุ่มใน Telegram)
  let sideJobs: { asked: number; remaining: number } | null = null;
  try {
    sideJobs = await sendSideJobConfirmations();
  } catch (err) {
    log.error('sidejob_confirm.failed', { err: (err as Error).message });
  }

  // ตัวเดียวกัน: เช้าวันที่ 1 (เวลาไทย) ส่งสรุปเดือนที่แล้วแยกรายเพื่อน พร้อมก๊อปส่ง
  let sideSummary: { sent: boolean; month?: string } | null = null;
  try {
    sideSummary = await sendMonthlySummariesIfFirstDay();
  } catch (err) {
    log.error('sidejob_summary.failed', { err: (err as Error).message });
  }

  log.info('refresh_day_status.done', { months, alert, places, sideJobs, sideSummary });
  return new Response(JSON.stringify({ ok: true, months, alert, places, sideJobs, sideSummary }), { status: 200 });
}
