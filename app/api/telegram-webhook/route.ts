// app/api/telegram-webhook/route.ts — แชมป์'s confirm/approve inbox.
// Receives Telegram `callback_query` updates only (inline-keyboard button taps).
// This is a single-user (แชมป์ only) admin surface — no signature scheme like LINE's,
// Telegram webhooks are instead protected by an unguessable path segment / secret token
// set at registration time (see apps-script/README or the setWebhook call in Phase 0).

import { answerCallbackQuery, sendTelegramMessage, TelegramUpdate } from '@/lib/telegram';
import { confirmAssignment } from '@/lib/assignments';
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

export async function POST(req: Request) {
  const secretHeader = req.headers.get('x-telegram-bot-api-secret-token');
  if (process.env.TELEGRAM_WEBHOOK_SECRET && secretHeader !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    log.warn('telegram_webhook.bad_secret');
    return new Response('unauthorized', { status: 401 });
  }

  const update = (await req.json()) as TelegramUpdate;
  const cq = update.callback_query;
  if (!cq) return new Response('ok', { status: 200 });

  const [action, ...rest] = cq.data.split(':');

  try {
    if (action === 'confirm_assign') {
      const [bookingEventId, driverId, driverDisplayName] = rest;
      await confirmAssignment(bookingEventId, driverId, driverDisplayName);
      await invalidateJobsCacheForVisibleMonths(); // คนขับคนอื่นที่เปิด picker ต่อจากนี้ต้องเห็นว่างานนี้มีคนขับแล้วทันที
      await answerCallbackQuery(cq.id, 'ยืนยันแล้ว ✅');
      await sendTelegramMessage(`✅ ยืนยันแล้ว: ${driverDisplayName} รับงาน ${bookingEventId}`);
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
      await answerCallbackQuery(cq.id);
      await sendTelegramMessage('เลือกคนขับแทนครับ:', buttons);
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
