// app/api/telegram-webhook/route.ts — แชมป์'s confirm/approve inbox.
// Receives Telegram `callback_query` updates only (inline-keyboard button taps).
// This is a single-user (แชมป์ only) admin surface — no signature scheme like LINE's,
// Telegram webhooks are instead protected by an unguessable path segment / secret token
// set at registration time (see apps-script/README or the setWebhook call in Phase 0).

import { answerCallbackQuery, sendTelegramMessage, TelegramUpdate } from '@/lib/telegram';
import { confirmAssignment, cancelAssignment, listAssignments } from '@/lib/assignments';
import { listCalendarEvents } from '@/lib/gas-client';
import { listDrivers } from '@/lib/drivers';
import { getLeaveRequest, resolveLeaveRequest } from '@/lib/leave';
import { markNeedsReassignment } from '@/lib/assignments';
import { invalidateJobsCache } from '@/lib/job-availability';
import { monthsInRollingRange } from '@/lib/date-range';
import { log } from '@/lib/log';

export const runtime = 'nodejs';

// ไม่รู้ job_date ของ booking ที่ถูกยืนยัน/ปลดจาก callback data ตรงๆ (มีแค่ eventId) — ล้าง cache
// ทุกเดือนที่ picker แสดงอยู่ตอนนี้ไปเลย ปลอดภัยกว่าและถูกกว่าการเสีย round-trip ไปหา job_date จริงก่อน
async function invalidateJobsCacheForVisibleMonths(): Promise<void> {
  await Promise.all(monthsInRollingRange().map((m) => invalidateJobsCache(m)));
}

/** งานที่ลงคนขับแล้ว (confirmed/notified) ตั้งแต่วันนี้เป็นต้นไป เรียงตามวัน พร้อมปุ่ม ❌ ยกเลิกรายงาน */
async function sendJobsList(): Promise<void> {
  const [assignments, drivers] = await Promise.all([listAssignments(), listDrivers()]);
  const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10); // วันที่ไทย
  const jobs = assignments
    .filter((a) => (a.status === 'confirmed' || a.status === 'notified') && a.job_date >= today)
    .sort((a, b) => (a.job_date + a.job_start_time).localeCompare(b.job_date + b.job_start_time))
    .slice(0, 20);

  if (jobs.length === 0) {
    await sendTelegramMessage('ตอนนี้ไม่มีงานที่ลงคนขับไว้ (ตั้งแต่วันนี้เป็นต้นไป) ครับ');
    return;
  }

  // ชื่องาน (เลข booking/แขก) จากปฏิทิน — ถ้าอ่านไม่ได้ก็แสดงแค่วัน/เวลา/คนขับ
  const names = new Map<string, string>();
  try {
    const to = new Date(Date.now() + 7 * 3600 * 1000 + 60 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const cal = await listCalendarEvents(`${today}T00:00:00+07:00`, `${to}T23:59:59+07:00`);
    if (cal.ok && cal.data) for (const ev of cal.data) names.set(ev.eventId, ev.summary.split('|').slice(0, 3).join('|').trim());
  } catch {
    /* ไม่มีชื่องานก็ยังใช้งานได้ */
  }

  const driverName = (id: string) => drivers.find((d) => d.driver_id === id)?.display_name ?? id;
  const lines = jobs.map((j, i) => `${i + 1}. ${j.job_date} ${j.job_start_time} — ${driverName(j.driver_id)}${names.get(j.booking_event_id) ? `\n    ${names.get(j.booking_event_id)}` : ''}`);
  const buttons = jobs.map((j, i) => [
    { text: `❌ ยกเลิก #${i + 1} ${j.job_date.slice(5)} ${j.job_start_time} ${driverName(j.driver_id)}`, callback_data: `unassign_ask:${j.booking_event_id}` },
  ]);
  await sendTelegramMessage(['📋 <b>งานที่ลงคนขับแล้ว</b>', '', ...lines].join('\n'), buttons);
}

export async function POST(req: Request) {
  const secretHeader = req.headers.get('x-telegram-bot-api-secret-token');
  if (process.env.TELEGRAM_WEBHOOK_SECRET && secretHeader !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    log.warn('telegram_webhook.bad_secret');
    return new Response('unauthorized', { status: 401 });
  }

  const update = (await req.json()) as TelegramUpdate;

  // ข้อความที่แชมป์พิมพ์เอง: /jobs = ดูงานที่ลงคนขับแล้ว พร้อมปุ่มยกเลิกรายงาน (ตอบเฉพาะแชมป์เท่านั้น)
  if (update.message?.text) {
    const champChat = process.env.TELEGRAM_CHAMP_CHAT_ID;
    if (champChat && String(update.message.chat.id) === champChat && /^\/?(jobs|help)\b|^\/?งาน/i.test(update.message.text.trim())) {
      try {
        await sendJobsList();
      } catch (err) {
        log.error('telegram_webhook.jobs_failed', { err: (err as Error).message });
        await sendTelegramMessage('ดึงรายการงานไม่ได้ชั่วคราว ลองใหม่อีกครั้งครับ');
      }
    }
    return new Response('ok', { status: 200 });
  }

  const cq = update.callback_query;
  if (!cq) return new Response('ok', { status: 200 });

  const [action, ...rest] = cq.data.split(':');

  try {
    if (action === 'confirm_assign') {
      const [bookingEventId, driverId, driverDisplayName] = rest;
      await confirmAssignment(bookingEventId, driverId, driverDisplayName);
      await invalidateJobsCacheForVisibleMonths(); // คนขับคนอื่นที่เปิด picker ต่อจากนี้ต้องเห็นว่างานนี้มีคนขับแล้วทันที
      await answerCallbackQuery(cq.id, 'ยืนยันแล้ว ✅');
      await sendTelegramMessage(`✅ ยืนยันแล้ว: ${driverDisplayName} รับงาน ${bookingEventId}`, [
        [
          { text: '🔄 เปลี่ยนคนขับ', callback_data: `reassign:${bookingEventId}` },
          { text: '❌ ยกเลิกคนขับ', callback_data: `unassign_ask:${bookingEventId}` },
        ],
      ]);
    } else if (action === 'reassign') {
      const [bookingEventId] = rest;
      const drivers = await listDrivers();
      const buttons = drivers
        .filter((d) => String(d.active).toUpperCase() === 'TRUE')
        .map((d) => [
          {
            text: d.display_name,
            callback_data: `confirm_assign:${bookingEventId}:${d.driver_id}:${d.display_name}`,
          },
        ]);
      buttons.push([{ text: '❌ ยกเลิกคนขับ (ไม่มีคนขับ)', callback_data: `unassign_ask:${bookingEventId}` }]);
      await answerCallbackQuery(cq.id);
      await sendTelegramMessage('เลือกคนขับแทนครับ:', buttons);
    } else if (action === 'unassign_ask') {
      // ขั้นยืนยันก่อนยกเลิกจริง (กันกดพลาด) — แชมป์เลือกได้ว่าจะจัดเอง หรือให้ระบบหาคนใหม่
      const [bookingEventId] = rest;
      await answerCallbackQuery(cq.id);
      await sendTelegramMessage(
        [
          '❓ <b>ยกเลิกคนขับของงานนี้?</b>',
          `งาน: <code>${bookingEventId}</code>`,
          '• ปฏิทินจะลบบรรทัด Driver ออก',
          '• ถ้าคนขับเคยได้รับแจ้งงานแล้ว ระบบจะส่ง LINE บอกว่ายกเลิก',
        ].join('\n'),
        [
          [{ text: '✅ ยกเลิก (ผมจัดเอง)', callback_data: `unassign_do:${bookingEventId}:m` }],
          [{ text: '🔁 ยกเลิก + ให้ระบบหาคนใหม่', callback_data: `unassign_do:${bookingEventId}:a` }],
          [{ text: '↩️ ไม่ยกเลิก', callback_data: `unassign_no:${bookingEventId}` }],
        ]
      );
    } else if (action === 'unassign_no') {
      await answerCallbackQuery(cq.id, 'ไม่ยกเลิกครับ');
    } else if (action === 'unassign_do') {
      const [bookingEventId, modeCode] = rest;
      const mode = modeCode === 'a' ? 'auto' : 'manual';
      const r = await cancelAssignment(bookingEventId, mode);
      await invalidateJobsCacheForVisibleMonths(); // งานนี้กลับเป็นว่าง — ให้ picker ของคนขับเห็นทันที
      if (!r.found) {
        await answerCallbackQuery(cq.id, 'ไม่พบงานนี้ หรือยกเลิกไปแล้ว');
        return new Response('ok', { status: 200 });
      }
      await answerCallbackQuery(cq.id, 'ยกเลิกคนขับแล้ว ✅');
      await sendTelegramMessage(
        [
          `❌ <b>ยกเลิกคนขับแล้ว</b> — ${r.driverName}`,
          `งาน: <code>${bookingEventId}</code> (${r.jobDate} ${r.jobStartTime})`,
          r.calendarOk ? 'ปฏิทิน: ลบชื่อคนขับแล้ว ✅' : '⚠️ ปฏิทิน: ลบชื่อคนขับไม่สำเร็จ รบกวนลบบรรทัด Driver: ในปฏิทินเอง',
          r.driverNotified ? 'แจ้งคนขับทาง LINE แล้ว' : 'ยังไม่ได้แจ้งคนขับ (คนขับยังไม่เคยได้รับแจ้งงานนี้)',
          mode === 'auto' ? '🔁 ระบบจะเสนอคนขับใหม่ให้กดยืนยันในรอบถัดไป' : 'ระบบจะไม่จับคู่งานนี้อัตโนมัติ — กด "จัดคนขับเอง" เมื่อพร้อม',
        ].join('\n'),
        [[{ text: '👤 จัดคนขับเอง', callback_data: `reassign:${bookingEventId}` }]]
      );
    } else if (action === 'approve_leave' || action === 'reject_leave') {
      const [requestId] = rest;
      const status = action === 'approve_leave' ? 'approved' : 'rejected';
      await resolveLeaveRequest(requestId, status);
      await answerCallbackQuery(cq.id, status === 'approved' ? 'อนุมัติแล้ว' : 'ปฏิเสธแล้ว');

      if (status === 'approved') {
        const request = await getLeaveRequest(requestId);
        if (request?.affected_booking_event_id) {
          await markNeedsReassignment(request.affected_booking_event_id);
          await invalidateJobsCacheForVisibleMonths(); // งานนี้เปิดว่างอีกครั้ง — เคลียร์ cache ให้ picker เห็นทันที
          await sendTelegramMessage(
            `🔁 อนุมัติลาแล้ว — งาน ${request.affected_booking_event_id} ต้องหาคนขับแทน (ระบบจะเสนอในรอบถัดไป)`
          );
        }
      }
    } else {
      log.warn('telegram_webhook.unknown_action', { action });
      await answerCallbackQuery(cq.id);
    }
  } catch (err) {
    log.error('telegram_webhook.error', { err: (err as Error).message });
    await answerCallbackQuery(cq.id, 'เกิดข้อผิดพลาด ลองใหม่ครับ');
  }

  return new Response('ok', { status: 200 });
}
