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
import { log } from './log';

function getLineClient() {
  return new Client({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
    channelSecret: process.env.LINE_CHANNEL_SECRET!,
  });
}

function nextMonthString(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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
    const month = nextMonthString();
    const selected = await getSelectedDates(driver.driver_id, month);
    await reply(replyToken, buildAvailabilityCarousel(month, selected));
    return;
  }

  if (text.includes('ลา') || text.includes('เปลี่ยนวัน')) {
    const month = nextMonthString();
    await reply(replyToken, buildLeaveDatePicker(month));
    return;
  }

  await reply(replyToken, {
    type: 'text',
    text: 'พิมพ์ "วันว่าง" เพื่อส่งวันว่างขับเดือนหน้า หรือ "ขอลา" เพื่อขอลา/เปลี่ยนวันครับ',
  });
}

export async function handleDriverPostback(
  driver: Driver,
  data: string,
  replyToken: string
): Promise<void> {
  const [action, ...rest] = data.split(':');

  if (action === 'avail' && rest[0] === 'pick') {
    const [, month, date] = rest;
    const selected = await toggleAvailabilityDate(driver.driver_id, month, date);
    await reply(replyToken, {
      type: 'text',
      text: `${selected.includes(date) ? '✅ เลือก' : '➖ ยกเลิก'}วันที่ ${date} (ตอนนี้เลือกไว้ ${selected.length} วัน — เลือกต่อได้เลย แล้วกด "ส่งวันว่างเดือนนี้" ที่ bubble สุดท้าย)`,
    });
    return;
  }

  if (action === 'avail' && rest[0] === 'submit') {
    const [, month] = rest;
    const selected = await getSelectedDates(driver.driver_id, month);
    await submitAvailability(driver.driver_id, month, selected);
    await clearSelectedDates(driver.driver_id, month);
    await reply(replyToken, {
      type: 'text',
      text: `ส่งวันว่างเดือน ${month} แล้วครับ (${selected.length} วัน) ขอบคุณครับ 🙏`,
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
