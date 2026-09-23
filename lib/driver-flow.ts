// lib/driver-flow.ts — everything a driver's LINE message/postback can trigger.
// Entirely postback/keyword-driven, never touches Gemini — kept separate from
// app/api/line-webhook/route.ts so the customer-facing path stays easy to read.
//
// v1 entry points are plain keywords ("ส่งวันว่าง" / "ขอลา") rather than a rich
// menu image, since no rich-menu asset exists yet — Champ can wire a rich menu to
// send these same strings later via LINE Official Account Manager without any
// code change here.

import { Client } from '@line/bot-sdk';
import { Driver } from './drivers';
import { buildAvailabilityCarousel, buildLeaveDatePicker } from './flex-driver';
import {
  toggleAvailabilityDate,
  getSelectedDates,
  clearSelectedDates,
  setPendingLeaveDate,
  popPendingLeaveDate,
} from './driver-state';
import { submitAvailability } from './availability';
import { createLeaveRequest } from './leave';
import { sendTelegramMessage } from './telegram';
import { DayStatus, getDayStatusMap } from './day-status';
import { JobEntry, getJobsForMonth } from './job-availability';
import { rollingDateRange, monthsInRollingRange } from './date-range';
import { log } from './log';

function getLineClient() {
  return new Client({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
    channelSecret: process.env.LINE_CHANNEL_SECRET!,
  });
}

/** รวม day-status ของทุกเดือนที่ rolling window แตะ (ปกติเดือนนี้+เดือนหน้า) เป็น map เดียว — ใช้กับ leave picker เท่านั้น */
async function combinedDayStatus(): Promise<Record<string, DayStatus>> {
  const maps = await Promise.all(monthsInRollingRange().map((m) => getDayStatusMap(m)));
  return Object.assign({}, ...maps);
}

/** รวม per-job map ของทุกเดือนที่ rolling window แตะ — ใช้กับ availability picker (ต้องสดกว่า day-status) */
async function combinedJobsByDate(): Promise<Record<string, JobEntry[]>> {
  const maps = await Promise.all(monthsInRollingRange().map((m) => getJobsForMonth(m)));
  return Object.assign({}, ...maps);
}

async function reply(replyToken: string, messages: Parameters<Client['replyMessage']>[1]) {
  try {
    await getLineClient().replyMessage(replyToken, messages);
  } catch (err) {
    log.error('driver_flow.reply_failed', { err: (err as Error).message });
  }
}

export async function handleDriverMessage(
  driver: Driver,
  text: string,
  replyToken: string
): Promise<void> {
  // ถ้ากำลังรอเหตุผลการลาอยู่ (พิมพ์ต่อจากเลือกวันแล้ว) ให้ตีความข้อความนี้เป็นเหตุผลก่อนเช็คคีย์เวิร์ดอื่น
  const pendingDate = await popPendingLeaveDate(driver.driver_id);
  if (pendingDate) {
    const requestId = await createLeaveRequest({
      driverId: driver.driver_id,
      dates: [pendingDate],
      reason: text,
    });
    await sendTelegramMessage(
      [
        '🙋 <b>คำขอลา/เปลี่ยนวัน</b>',
        `คนขับ: ${driver.display_name}`,
        `วันที่: ${pendingDate}`,
        `เหตุผล: ${text}`,
      ].join('\n'),
      [
        [
          { text: '✅ อนุมัติ', callback_data: `approve_leave:${requestId}` },
          { text: '❌ ปฏิเสธ', callback_data: `reject_leave:${requestId}` },
        ],
      ]
    );
    await reply(replyToken, { type: 'text', text: `ส่งคำขอลาวันที่ ${pendingDate} ให้แชมป์แล้วครับ รอผลอนุมัติ` });
    return;
  }

  if (text.includes('วันว่าง')) {
    const dates = rollingDateRange();
    const [selected, jobsByDate] = await Promise.all([getSelectedDates(driver.driver_id), combinedJobsByDate()]);
    await reply(replyToken, buildAvailabilityCarousel(dates, selected, jobsByDate));
    return;
  }

  if (text.includes('ลา') || text.includes('เปลี่ยนวัน')) {
    const dates = rollingDateRange();
    const dayStatus = await combinedDayStatus();
    await reply(replyToken, buildLeaveDatePicker(dates, dayStatus));
    return;
  }

  await reply(replyToken, {
    type: 'text',
    text: 'พิมพ์ "วันว่าง" เพื่อส่งวันว่างขับ (ตั้งแต่วันนี้ถึงสิ้นเดือนหน้า) หรือ "ขอลา" เพื่อขอลา/เปลี่ยนวันครับ',
  });
}

export async function handleDriverPostback(
  driver: Driver,
  data: string,
  replyToken: string
): Promise<void> {
  const [action, ...rest] = data.split(':');

  if (action === 'avail' && rest[0] === 'pick') {
    const [, token] = rest;
    const [date, eventId] = token.split('#');
    const jobs = (await getJobsForMonth(date.slice(0, 7)))[date] ?? [];

    // เช็คสถานะสดก่อนอนุญาตให้ toggle — กันคนขับกดปุ่มจากการ์ดเก่าที่ค้างอยู่หลังงานนั้นมีคนขับไปแล้ว
    if (eventId) {
      const job = jobs.find((j) => j.eventId === eventId);
      if (job?.confirmed) {
        await reply(replyToken, {
          type: 'text',
          text: `ขออภัยครับ งานวันที่ ${date} เวลา ${job.startTime} มีคนขับแล้วครับ (${job.confirmedDriverName ?? '-'}) — เลือกงานอื่นแทนได้เลยครับ`,
        });
        return;
      }
    } else if (jobs.length === 1 && jobs[0].confirmed) {
      await reply(replyToken, {
        type: 'text',
        text: `ขออภัยครับ วันที่ ${date} มีคนขับแล้วครับ (${jobs[0].confirmedDriverName ?? '-'})`,
      });
      return;
    }

    const selected = await toggleAvailabilityDate(driver.driver_id, token);
    const timeLabel = eventId ? ` ${jobs.find((j) => j.eventId === eventId)?.startTime ?? ''}` : '';
    await reply(replyToken, {
      type: 'text',
      text: `${selected.includes(token) ? '✅ เลือก' : '➖ ยกเลิก'}วันที่ ${date}${timeLabel} (ตอนนี้เลือกไว้ ${selected.length} รายการ — เลือกต่อได้เลย แล้วกด "ส่งวันว่าง" ที่ bubble สุดท้าย)`,
    });
    return;
  }

  if (action === 'avail' && rest[0] === 'submit') {
    const rawSelected = await getSelectedDates(driver.driver_id);

    // re-validate ก่อนบันทึกจริง — กันเคสงานถูกยืนยันคนขับไปแล้วระหว่างที่คนขับกำลังเลือกอยู่ (ระหว่าง pick ครั้งแรกกับตอนกด submit)
    const monthsTouched = Array.from(new Set(rawSelected.map((t) => t.slice(0, 7))));
    const jobMapsByMonth = new Map(await Promise.all(monthsTouched.map(async (m) => [m, await getJobsForMonth(m)] as const)));

    let droppedCount = 0;
    const selected = rawSelected.filter((token) => {
      const [date, eventId] = token.split('#');
      if (!eventId) return true; // token เปล่า ไม่ผูกงานเจาะจง ไม่มีอะไรให้ค้าง
      const jobs = jobMapsByMonth.get(date.slice(0, 7))?.[date] ?? [];
      const job = jobs.find((j) => j.eventId === eventId);
      if (job?.confirmed) {
        droppedCount += 1;
        return false;
      }
      return true;
    });

    // rolling window คร่อมได้หลายเดือนปฏิทิน — แยกวันตามเดือนก่อนเขียนลง Availability_Monthly (1 แถว/เดือน)
    const byMonth = new Map<string, string[]>();
    for (const token of selected) {
      const month = token.slice(0, 7);
      byMonth.set(month, [...(byMonth.get(month) ?? []), token]);
    }
    for (const [month, tokensInMonth] of Array.from(byMonth.entries())) {
      await submitAvailability(driver.driver_id, month, tokensInMonth);
    }
    await clearSelectedDates(driver.driver_id);
    await reply(replyToken, {
      type: 'text',
      text: `ส่งวันว่างแล้วครับ (${selected.length} รายการ)${droppedCount ? ` — ${droppedCount} งานมีคนขับแล้วก่อนที่จะส่ง เลยตัดออกให้` : ''} ขอบคุณครับ 🙏`,
    });
    return;
  }

  if (action === 'leave' && rest[0] === 'pick') {
    const [, date] = rest;
    await setPendingLeaveDate(driver.driver_id, date);
    await reply(replyToken, { type: 'text', text: `เลือกวันที่ ${date} แล้ว — พิมพ์เหตุผลสั้นๆ ส่งมาได้เลยครับ` });
    return;
  }

  log.warn('driver_flow.unknown_postback', { data });
}
