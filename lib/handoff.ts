// lib/handoff.ts — Smart Handoff: detect triggers -> notify admin group

import { Client } from '@line/bot-sdk';
import { log } from './log';

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
  // เรื่องเงิน/เปลี่ยนแปลงการจอง — บอทจัดการเองไม่ได้ ต้องส่งต่อแชมป์
  'คืนเงิน',
  'ขอยกเลิก',
  'ยกเลิกการจอง',
  'ยกเลิกจอง',
  'ย้ายวัน',
  'เลื่อนวัน',
  'เปลี่ยนวัน',
  'refund',
  'cancel my',
  'cancel the',
  'cancel booking',
  'want to cancel',
  'to cancel',
  'cancellation',
  'reschedule',
  'change the date',
  'change my booking',
  'real person',
  'talk to a human',
  'complaint',
];

export function shouldHandoff(message: string): boolean {
  const lower = message.toLowerCase();
  return HANDOFF_TRIGGERS.some((trigger) =>
    lower.includes(trigger.toLowerCase())
  );
}

// Lazy init — create client only when needed, not at module load time
function getLineClient() {
  return new Client({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
    channelSecret: process.env.LINE_CHANNEL_SECRET!,
  });
}

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
    await getLineClient().pushMessage(adminGroupId, {
      type: 'text',
      text: '🔔 ลูกค้าต้องการคุยกับพี่แชมป์' + '\n\n' + 'UserID: ' + userId + '\n' + 'ข้อความ: ' + userMessage + '\n\n' + 'ตอบได้ที่: https://manager.line.biz/chats',
    });
    log.info('handoff.admin_notified', { userId });
  } catch (err) {
    log.error('handoff.notify_failed', { err: (err as Error).message });
  }
}
