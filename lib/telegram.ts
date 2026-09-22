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

interface InlineButton {
  text: string;
  callback_data: string; // e.g. "confirm_assign:{bookingEventId}:{driverId}"
}

function apiUrl(method: string): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set');
  return `${API_BASE}/bot${token}/${method}`;
}

export async function sendTelegramMessage(
  text: string,
  buttons?: InlineButton[][]
): Promise<void> {
  const chatId = process.env.TELEGRAM_CHAMP_CHAT_ID;
  if (!chatId) {
    log.error('telegram.no_chat_id');
    return;
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
    } else {
      log.info('telegram.send_ok');
    }
  } catch (err) {
    log.error('telegram.send_error', { err: (err as Error).message });
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

export interface TelegramUpdate {
  callback_query?: TelegramCallbackQuery;
}
