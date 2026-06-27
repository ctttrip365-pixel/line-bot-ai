// lib/history.ts — Persistent chat history via Upstash Redis (48h TTL)
// Bot จำบทสนทนาทุก turn ไม่ reset แม้ Vercel cold start

import { Redis } from '@upstash/redis';

function getRedis(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    const missing = [!url && 'UPSTASH_REDIS_REST_URL', !token && 'UPSTASH_REDIS_REST_TOKEN']
      .filter(Boolean)
      .join(', ');
    console.error(JSON.stringify({ event: 'redis.missing_env', missing }));
    throw new Error(`Redis env vars missing: ${missing}`);
  }
  return new Redis({ url, token });
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
    console.log(JSON.stringify({ event: 'history.get_ok', userId, count: (data ?? []).length }));
    return data ?? [];
  } catch (err) {
    console.error(JSON.stringify({ event: 'history.get_failed', userId, err: (err as Error).message }));
    return []; // bot ยังทำงานได้ แต่ไม่มี context
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
    const trimmed = history.length > MAX_MESSAGES ? history.slice(-MAX_MESSAGES) : history;
    await getRedis().set(`chat:${userId}`, trimmed, { ex: TTL_SECONDS });
    console.log(JSON.stringify({ event: 'history.append_ok', userId, count: trimmed.length }));
  } catch (err) {
    console.error(JSON.stringify({ event: 'history.append_failed', userId, err: (err as Error).message }));
  }
}
