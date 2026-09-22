// app/api/dispatch/refresh-day-status/route.ts — Vercel Cron target, once daily
// (see vercel.json). Recomputes the "ว่าง/ไม่มีงาน/มีคนขับ" status shown on the
// driver availability/leave pickers for this month + next month, and caches it
// in Redis so the LINE webhook never has to do this work on the request path.

import { cacheDayStatusMap } from '@/lib/day-status';
import { log } from '@/lib/log';

export const runtime = 'nodejs';

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
  }

  log.info('refresh_day_status.done', { months });
  return new Response(JSON.stringify({ ok: true, months }), { status: 200 });
}
