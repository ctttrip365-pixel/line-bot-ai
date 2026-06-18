// lib/handoff.ts — Smart Handoff: detect triggers → notify admin group

import { Client } from '@line/bot-sdk';
import { log } from './log';

// Keywords ที่ต้อง route ไปให้พี่แชมป์ดูแลเอง
const HANDOFF_TRIGGERS = [
  'คุยกับแชมป์',
  'คุยกับคน',
  'ขอแอดมิน',
  'ขอเจ้าของ',
  'ฟ้อง',
  'ร้องเรียน',
  'ไม่พอใจ',
  'เหมาทั้งวัน',
  'จองกรุ๊ป',
  'ราคาพิเศษ',
  'ส่วนลดพิเศษ',
  'ขนส่งสินค้า',
  'logistics',
  'ส่งของ',
  'ขายส่ง',
  'wholesale',
  'franchise',
];

export function shouldHandoff(message: string): boolean {
  const lower = message.toLowerCase();
  return HANDOFF_TRIGGERS.some((trigger) =>
    lower.includes(trigger.toLowerCase())
  );
}

const lineClient = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
  channelSecret: process.env.LINE_CHANNEL_SECRET!,
});

export async function notifyAdmin(
  userId: string,
  userMessage: string
): Promise<void> {
  const adminGroupId = process.env.ADMIN_GROUP_ID;
  if (!adminGroupId) {
    log.warn('handoff.no_admin_group', { note: 'ADMIN_GROUP_ID not set' });
    return;
  }

  try {
    await lineClient.pushMessage(adminGroupId, {
      type: 'text',
      text: `🔔 ลูกค้าต้องการคุยกับพี่แชมป์\n\nUserID: ${userId}\nข้อความ: ${userMessage}\n\nตอบได้ที่: https://manager.line.biz/chats`,
    });
    log.info('handoff.admin_notified', { userId });
  } catch (err) {
    log.error('handoff.notify_failed', { err: (err as Error).message });
  }
}
