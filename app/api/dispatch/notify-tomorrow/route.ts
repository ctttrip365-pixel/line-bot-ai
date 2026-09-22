// app/api/dispatch/notify-tomorrow/route.ts — Vercel Cron target, runs daily at
// 22:00 Asia/Bangkok (see vercel.json). Pure "read confirmed data, send templated
// LINE message" — zero judgment, so it must run unattended every single day
// regardless of whether แชมป์'s Mac / a Claude Code session is on. Do NOT move this
// to a Claude Code scheduled task or desktop automation — see the design plan's
// "risk flags" section for why.

import { Client } from '@line/bot-sdk';
import { listAssignments, markNotified } from '@/lib/assignments';
import { listDrivers, findDriverById } from '@/lib/drivers';
import { listCalendarEvents } from '@/lib/gas-client';
import { parseBookingDescription } from '@/lib/booking-parse';
import { buildJobNoticeText } from '@/lib/flex-driver';
import { log } from '@/lib/log';

export const runtime = 'nodejs';

function getLineClient() {
  return new Client({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
    channelSecret: process.env.LINE_CHANNEL_SECRET!,
  });
}

function tomorrowDateString(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('unauthorized', { status: 401 });
  }

  const tomorrow = tomorrowDateString();
  const [assignments, drivers, calendarRes] = await Promise.all([
    listAssignments(),
    listDrivers(),
    listCalendarEvents(`${tomorrow}T00:00:00+07:00`, `${tomorrow}T23:59:59+07:00`),
  ]);

  const toNotify = assignments.filter((a) => a.status === 'confirmed' && a.job_date === tomorrow);
  const events = calendarRes.ok ? calendarRes.data ?? [] : [];

  let sent = 0;
  for (const a of toNotify) {
    const driver = findDriverById(drivers, a.driver_id);
    const event = events.find((e) => e.eventId === a.booking_event_id);
    if (!driver || !driver.line_user_id || !event) {
      log.warn('notify_tomorrow.missing_data', {
        bookingEventId: a.booking_event_id,
        hasDriver: !!driver,
        hasEvent: !!event,
      });
      continue;
    }

    const parsed = parseBookingDescription(event.description);
    try {
      await getLineClient().pushMessage(driver.line_user_id, buildJobNoticeText({ ...parsed }));
      await markNotified(a.booking_event_id);
      sent += 1;
    } catch (err) {
      log.error('notify_tomorrow.push_failed', {
        bookingEventId: a.booking_event_id,
        err: (err as Error).message,
      });
    }
  }

  log.info('notify_tomorrow.done', { tomorrow, candidates: toNotify.length, sent });
  return new Response(JSON.stringify({ ok: true, sent }), { status: 200 });
}
