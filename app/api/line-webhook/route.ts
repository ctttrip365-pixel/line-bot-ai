// app/api/line-webhook/route.ts — Production webhook handler
// v4: Redis-backed 48h conversation history — bot จำบทสนทนาไม่ลืมแม้ Vercel cold start

import { Client, validateSignature, WebhookEvent } from '@line/bot-sdk';
import { fetchFAQ } from '@/lib/sheet';
import { generateReply, DEFAULT_REPLY } from '@/lib/gemini';
import { shouldHandoff, notifyAdmin } from '@/lib/handoff';
import { parseBookingConfirmation, cleanReply } from '@/lib/calendar';
import { createCheckoutSession } from '@/lib/stripe';
import { getHistory, appendHistory } from '@/lib/history';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const maxDuration = 30;

function getLineClient() {
  return new Client({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
    channelSecret: process.env.LINE_CHANNEL_SECRET!,
  });
}

export async function POST(req: Request) {
  const signature = req.headers.get('x-line-signature') || '';
  const body = await req.text();

  if (!validateSignature(body, process.env.LINE_CHANNEL_SECRET!, signature)) {
    log.warn('webhook.invalid_signature');
    return new Response('invalid signature', { status: 401 });
  }

  const events: WebhookEvent[] = JSON.parse(body).events;

  await Promise.all(
    events.map(async (event) => {
      if (event.type !== 'message' || event.message.type !== 'text') return;

      const userMessage = event.message.text;
      const userId = event.source.userId || 'unknown';
      const startTime = Date.now();

      try {
        if (shouldHandoff(userMessage)) {
          await notifyAdmin(userId, userMessage);
          await replyWithRetry(event.replyToken!, 'ขอแจ้พี่แชมป์ติดต่อกลับนะครับ 🙏', 3);
          log.info('handoff.routed', { userId, latencyMs: Date.now() - startTime });
          return;
        }

        const [faqText, history] = await Promise.all([
          fetchFAQ(),
          getHistory(userId),
        ]);

        const rawReply = await Promise.race([
          generateReply(userMessage, faqText, history),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('gemini_timeout')), 8000)
          ),
        ]).catch((err) => {
          log.error('gemini.failed', { err: err.message, userId });
          return DEFAULT_REPLY;
        });

        const booking = parseBookingConfirmation(rawReply, userId);
        let finalReply = cleanReply(rawReply);

        if (booking) {
          log.info('booking.confirmed', {
            userId, date: booking.date, time: booking.time,
            pickup: booking.pickup, dropoff: booking.dropoff,
            pax: booking.pax, amount: booking.amount,
          });

          try {
            const amount = Number(booking.amount) || 600;
            const paymentUrl = await createCheckoutSession({
              amount, date: booking.date, time: booking.time,
              pickup: booking.pickup, dropoff: booking.dropoff,
              pax: booking.pax, lineUserId: userId,
            });
            finalReply = [
              finalReply, '',
              '💳 ชำระเงินได้ที่ลิงก์นี้เลยครับ:',
              paymentUrl, '',
              '⏱ ลิงก์หมดอายุใน 1 ชั่วโมง',
              'หลังชำระแล้วจะได้รับการยืนยันทาง LINE ทันทีเลยครับ',
            ].join('\n');
            log.info('stripe.link_created', { userId, amount, paymentUrl });
          } catch (err) {
            log.error('stripe.link_failed', { err: (err as Error).message, userId });
            finalReply = [
              finalReply, '',
              '⚠️ ระบบชำระเงินออนไลน์มีปัญหาชั่วคราวครับ',
              'กรุณาโอนเงินและส่ง slip มาที่ LINE นี้',
              'หรือโทร +66 94 269 4651 ครับ',
            ].join('\n');
          }
        }

        await replyWithRetry(event.replyToken!, finalReply, 3);

        // บันทึก history หลังตอบลูกค้าเรียบร้อย (non-blocking)
        appendHistory(userId, userMessage, finalReply).catch(() => {});

        log.info('reply.sent', {
          userId,
          latencyMs: Date.now() - startTime,
          replyLength: finalReply.length,
          hasBooking: !!booking,
          historyTurns: history.length / 2,
        });
      } catch (err) {
        log.error('webhook.error', { err: (err as Error).message, userId });
        try {
          await getLineClient().replyMessage(event.replyToken!, { type: 'text', text: DEFAULT_REPLY });
        } catch { /* replyToken expired */ }
      }
    })
  );

  return new Response('ok', { status: 200 });
}

async function replyWithRetry(replyToken: string, text: string, attempts: number): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await getLineClient().replyMessage(replyToken, { type: 'text', text });
      return;
    } catch (err) {
      if (i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
}
