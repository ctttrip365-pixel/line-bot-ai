// lib/handoff.ts — Smart Handoff: detect triggers -> notify admin group

import { Client } from '@line/bot-sdk';
import { log } from './log';
import { sendTelegramMessage } from './telegram';

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

function escapeHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * แจ้งแชมป์ว่ามีลูกค้าต้องการคนจริง — ส่งทั้งกลุ่มแอดมิน LINE และ Telegram (push เด้งมือถือแชมป์)
 * สองช่องทางทำงานแยกกัน ช่องหนึ่งพังไม่กระทบอีกช่อง
 */
export async function notifyAdmin(
  userId: string,
  userMessage: string,
  reason: string = 'ลูกค้าต้องการคุยกับพี่แชมป์'
): Promise<void> {
  const preview = userMessage.length > 500 ? userMessage.slice(0, 500) + '…' : userMessage;
  const manager = 'https://manager.line.biz/chats';

  // 1) กลุ่มแอดมินใน LINE
  const adminGroupId = process.env.ADMIN_GROUP_ID;
  if (!adminGroupId) {
    log.warn('handoff.no_admin_group', { note: 'ADMIN_GROUP_ID not set' });
  } else {
    try {
      await getLineClient().pushMessage(adminGroupId, {
        type: 'text',
        text: '🔔 ' + reason + '\n\n' + 'UserID: ' + userId + '\n' + 'ข้อความ: ' + preview + '\n\n' + 'ตอบได้ที่: ' + manager,
      });
      log.info('handoff.admin_notified', { userId });
    } catch (err) {
      log.error('handoff.notify_failed', { err: (err as Error).message });
    }
  }

  // 2) Telegram ของแชมป์ (ล้มเหลวจะ log เองใน sendTelegramMessage ไม่ throw)
  try {
    await sendTelegramMessage(
      [
        '🔔 <b>' + escapeHtml(reason) + '</b>',
        '',
        'ข้อความลูกค้า: ' + escapeHtml(preview),
        'UserID: <code>' + escapeHtml(userId) + '</code>',
        '',
        'ตอบที่ LINE OA Manager: ' + manager,
      ].join('\n')
    );
  } catch (err) {
    log.error('handoff.telegram_failed', { err: (err as Error).message });
  }
}
