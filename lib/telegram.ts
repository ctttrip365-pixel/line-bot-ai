// lib/telegram.ts — thin Telegram Bot API client.
//
// Used ONLY for แชมป์'s own confirm/approve inbox (auto-assign proposals, leave
// approvals) — deliberately separate from @ctt.trip365 LINE OA:
//   - trivial setup (message @BotFather, no business verification)
//   - push messages are free/unlimited, doesn't share LINE OA's push quota
//   - zero risk of ever mixing with customer-facing chat (different app entirely)
// Drivers still use LINE (lib/flex-driver.ts) — this file is Champ-only.

import { log } from './log';

const API_BASE = 'https://api.telegram.org';

export interface InlineButton {
  text: string;
  callback_data: string; // e.g. "confirm_assign:{bookingEventId}:{driverId}"
}

function apiUrl(method: string): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set');
  return `${API_BASE}/bot${token}/${method}`;
}

/** คืน message_id ของข้อความที่ส่ง (ใช้ผูกการ์ด↔งาน เพื่อให้แชมป์ reply แก้ไขได้) — ส่งไม่สำเร็จคืน undefined */
export async function sendTelegramMessage(
  text: string,
  buttons?: InlineButton[][]
): Promise<number | undefined> {
  const chatId = process.env.TELEGRAM_CHAMP_CHAT_ID;
  if (!chatId) {
    log.error('telegram.no_chat_id');
    return undefined;
  }

  try {
    const res = await fetch(apiUrl('sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        reply_markup: buttons ? { inline_keyboard: buttons } : undefined,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      log.error('telegram.send_failed', { status: res.status, body: await res.text() });
      return undefined;
    }
    log.info('telegram.send_ok');
    const json = (await res.json().catch(() => null)) as { result?: { message_id?: number } } | null;
    return json?.result?.message_id;
  } catch (err) {
    log.error('telegram.send_error', { err: (err as Error).message });
    return undefined;
  }
}

/** แก้ข้อความเดิม (เช่น อัปเดตการ์ดงานหลังแก้ไข) — buttons ไม่ส่ง = คงปุ่มเดิม; "message is not modified" ถือว่าสำเร็จ */
export async function editTelegramMessage(messageId: number, text: string, buttons?: InlineButton[][]): Promise<boolean> {
  const chatId = process.env.TELEGRAM_CHAMP_CHAT_ID;
  if (!chatId) return false;
  try {
    const res = await fetch(apiUrl('editMessageText'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        reply_markup: buttons ? { inline_keyboard: buttons } : undefined,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return true;
    const body = await res.text();
    if (body.includes('message is not modified')) return true;
    log.error('telegram.edit_failed', { status: res.status, body });
    return false;
  } catch (err) {
    log.error('telegram.edit_error', { err: (err as Error).message });
    return false;
  }
}

/** แสดง "กำลังพิมพ์..." ระหว่างรอ Gemini อ่านไฟล์ (ไม่ต้องรอผล ล้มเหลวก็ไม่เป็นไร) */
export async function sendTypingAction(): Promise<void> {
  const chatId = process.env.TELEGRAM_CHAMP_CHAT_ID;
  if (!chatId) return;
  try {
    await fetch(apiUrl('sendChatAction'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    /* ไม่สำคัญ */
  }
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', pdf: 'application/pdf',
};
const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024; // Bot API โหลดได้สูงสุด 20MB; ตัดที่ 15MB กันหน่วยความจำ/เวลาเกิน

/** โหลดไฟล์จาก Telegram (รูป/PDF ที่แชมป์ส่งมา) — ไม่เก็บ URL (มี token) ลงที่ไหน เก็บแค่ file_id */
export async function downloadTelegramFile(fileId: string, hintMime?: string): Promise<{ data: Buffer; mimeType: string } | null> {
  try {
    const meta = await fetch(apiUrl('getFile'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
      signal: AbortSignal.timeout(8000),
    });
    if (!meta.ok) {
      log.error('telegram.getfile_failed', { status: meta.status });
      return null;
    }
    const j = (await meta.json()) as { result?: { file_path?: string; file_size?: number } };
    const path = j.result?.file_path;
    if (!path) return null;
    if ((j.result?.file_size ?? 0) > MAX_DOWNLOAD_BYTES) {
      log.warn('telegram.file_too_large', { size: j.result?.file_size });
      return null;
    }
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const res = await fetch(`${API_BASE}/file/bot${token}/${path}`, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      log.error('telegram.download_failed', { status: res.status });
      return null;
    }
    const data = Buffer.from(await res.arrayBuffer());
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const mimeType = hintMime && hintMime !== 'application/octet-stream' ? hintMime : MIME_BY_EXT[ext] ?? 'image/jpeg';
    return { data, mimeType };
  } catch (err) {
    log.error('telegram.download_error', { err: (err as Error).message });
    return null;
  }
}

/** ต้องเรียกทุกครั้งหลังกดปุ่ม ไม่งั้นปุ่มจะค้าง "loading" ในแอป Telegram ของแชมป์ */
export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  try {
    await fetch(apiUrl('answerCallbackQuery'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    log.error('telegram.answer_callback_failed', { err: (err as Error).message });
  }
}

export interface TelegramCallbackQuery {
  id: string;
  data: string;
  message?: { chat: { id: number }; message_id: number };
}

export interface TelegramPhotoSize {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
  caption?: string; // ข้อความที่พิมพ์แนบมากับรูป/ไฟล์
  photo?: TelegramPhotoSize[]; // หลายขนาดของรูปเดียว (ตัวท้ายสุด = ใหญ่สุด)
  document?: TelegramDocument;
  media_group_id?: string; // รูปที่ส่งพร้อมกันหลายใบ Telegram แยกเป็นหลาย update ที่มี id นี้ร่วมกัน
  reply_to_message?: { message_id: number };
}

export interface TelegramUpdate {
  update_id?: number;
  callback_query?: TelegramCallbackQuery;
  message?: TelegramMessage; // ข้อความ/รูป/ไฟล์ที่แชมป์ส่งมา — ต้องตั้ง webhook ให้รับ update ชนิด message ด้วย
}
