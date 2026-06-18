// app/api/line-webhook/route.ts — Production webhook handler
// Features: signature verify · parallel events · Smart Handoff · Gemini timeout · retry

import { Client, validateSignature, WebhookEvent } from '@line/bot-sdk';
import { fetchFAQ } from '@/lib/sheet';
import { generateReply, DEFAULT_REPLY } from '@/lib/gemini';
import { shouldHandoff, notifyAdmin } from '@/lib/handoff';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const maxDuration = 30; // Vercel Hobby limit

const lineClient = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
  channelSecret: process.env.LINE_CHANNEL_SECRET!,
});

export async function POST(req: Request) {
  const signature = req.headers.get('x-line-signature') || '';
  const body = await req.text();

  // 1. Verify signature — กันคนปลอม request
  if (!validateSignature(body, process.env.LINE_CHANNEL_SECRET!, signature)) {
    log.warn('webhook.invalid_signature');
    return new Response('invalid signature', { status: 401 });
  }

  const events: WebhookEvent[] = JSON.parse(body).events;

  // 2. Process events in parallel (LINE batches multiple events ในครั้งเดียว)
  await Promise.all(
    events.map(async (event) => {
      if (event.type !== 'message' || event.message.type !== 'text') return;

      const userMessage = event.message.text;
      const userId = event.source.userId || 'unknown';
      const startTime = Date.now();

      try {
        // 3. Smart Handoff — check ก่อน Gemini เพื่อประหยัด latency
        if (shouldHandoff(userMessage)) {
          await notifyAdmin(userId, userMessage);
          await replyWithRetry(
            event.replyToken!,
            'ขอแจ้งพี่แชมป์ติดต่อกลับนะครับ 🙏',
            3
          );
          log.info('handoff.routed', {
            userId,
            latencyMs: Date.now() - startTime,
          });
          return;
        }

        // 4. Fetch FAQ (cached 60s)
        const faqText = await fetchFAQ();

        // 5. Call Gemini with 8s timeout (webhook ต้องตอบภายใน 10s)
        const reply = await Promise.race([
          generateReply(userMessage, faqText),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('gemini_timeout')), 8000)
          ),
        ]).catch((err) => {
          log.error('gemini.failed', { err: err.message, userId });
          return DEFAULT_REPLY;
        });

        // 6. Reply LINE with retry
        await replyWithRetry(event.replyToken!, reply, 3);

        log.info('reply.sent', {
          userId,
          latencyMs: Date.now() - startTime,
          replyLength: reply.length,
        });
      } catch (err) {
        log.error('webhook.error', {
          err: (err as Error).message,
          userId,
        });
        // Best-effort fallback
        try {
          await lineClient.replyMessage(event.replyToken!, {
            type: 'text',
            text: DEFAULT_REPLY,
          });
        } catch {
          /* replyToken อาจหมดอายุแล้ว · swallow */
        }
      }
    })
  );

  return new Response('ok', { status: 200 });
}

// Retry with exponential backoff — LINE API ตอบช้าบางครั้ง
async function replyWithRetry(
  replyToken: string,
  text: string,
  attempts: number
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await lineClient.replyMessage(replyToken, { type: 'text', text });
      return;
    } catch (err) {
      if (i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 300 * (i + 1))); // 300ms, 600ms, 900ms
    }
  }
}
