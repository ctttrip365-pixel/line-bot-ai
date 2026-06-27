// lib/history.ts — Persistent chat history via Upstash Redis (48h TTL)
// Bot จำบทสนทนาทุก turn ไม่ reset แม้ Vercel cold start

import { Redis } from '@upstash/redis';
import { log } from './log';

function getRedis(): Redis {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

const TTL_SECONDS = 48 * 60 * 60; // 48 ชั่วโมง
const MAX_MESSAGES = 40;           // 20 turns = user+model แต่ละ 1

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export async function getHistory(userId: string): Promise<ChatMessage[]> {
  try {
    const data = await getRedis().get<ChatMessage[]>(`chat:${userId}`);
    return data ?? [];
  } catch (err) {
    log.warn('history.get_failed', { userId, err: (err as Error).message });
    return []; // bot ยังทำงานได้ แค่ไม่มี context
  }
}

export async function appendHistory(
  userId: string,
  userText: string,
  modelText: string
): Promise<void> {
  try {
    const history = await getHistory(userId);
    history.push({ role: 'user', text: userText });
    history.push({ role: 'model', text: modelText });

    // Trim เก็บเฉพาะ MAX_MESSAGES ล่าสุด ลด payload ใน Redis
    const trimmed = history.length > MAX_MESSAGES
      ? history.slice(-MAX_MESSAGES)
      : history;

    await getRedis().set(`chat:${userId}`, trimmed, { ex: TTL_SECONDS });
  } catch (err) {
    log.warn('history.append_failed', { userId, err: (err as Error).message });
  }
}
