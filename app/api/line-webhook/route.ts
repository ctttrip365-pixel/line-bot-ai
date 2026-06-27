// app/api/line-webhook/route.ts — Production webhook handler
// v3: booking confirmed → สร้าง Stripe link → ส่งให้ลูกค้าจ่าย → Stripe webhook สร้าง Calendar

import { Client, validateSignature, WebhookEvent } from '@line/bot-sdk';
import { fetchFAQ } from '@/lib/sheet';
import { generateReply, DEFAULT_REPLY } from '@/lib/gemini';
import { shouldHandoff, notifyAdmin } from '@/lib/handoff';
import { parseBookingConfirmation, cleanReply } from '@/lib/calendar';
import { createCheckoutSession } from '@/lib/stripe';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Lazy init — ไม่สร้าง client ตอน module load (ป้องกัน build crash)
function getLineClient() {
  return new Client({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
    channelSecret: process.env.LINE_CHANNEL_SECRET!,
  });
}

export async function POST(req: Request) {
  const signature = req.headers.get('x-line-signature') || '';
  const body = await req.text();

  // 1. Verify signature
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
        // 2. Smart Handoff
        if (shouldHandoff(userMessage)) {
          await notifyAdmin(userId, userMessage);
          await replyWithRetry(
            event.replyToken!,
            'ขอแจ้งพี่แชมป์ติดต่อกลับนะครับ 🙏',
            3
          );
          log.info('handoff.routed', { userId, latencyMs: Date.now() - startTime });
          return;
        }

        // 3. Fetch FAQ
        const faqText = await fetchFAQ();

        // 4. Call Gemini with 8s timeout
        const rawReply = await Promise.race([
          generateReply(userMessage, faqText),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('gemini_timeout')), 8000)
          ),
        ]).catch((err) => {
          log.error('gemini.failed', { err: err.message, userId });
          return DEFAULT_REPLY;
        });

        // 5. ตรวจว่า Gemini ยืนยันการจองหรือเปล่า
        const booking = parseBookingConfirmation(rawReply, userId);
        let finalReply = cleanReply(rawReply);

        if (booking) {
          log.info('booking.confirmed', {
            userId,
            date: booking.date,
            time: booking.time,
            pickup: booking.pickup,
            dropoff: booking.dropoff,
            pax: booking.pax,
            amount: booking.amount,
          });

          // 6. สร้าง Stripe Checkout link
          try {
            const amount = Number(booking.amount) || 600;
            const paymentUrl = await createCheckoutSession({
              amount,
              date: booking.date,
              time: booking.time,
              pickup: booking.pickup,
              dropoff: booking.dropoff,
              pax: booking.pax,
              lineUserId: userId,
            });

            finalReply = [
              finalReply,
              '',
              '💳 ชำระเงินได้ที่ลิงก์นี้เลยครับ:',
              paymentUrl,
              '',
              '⏱ ลิงก์หมดอายุใน 1 ชั่วโมง',
              'หลังชำระแล้วจะได้รับการยืนยันทาง LINE ทันทีครับ',
            ].join('\n');

            log.info('stripe.link_created', { userId, amount, paymentUrl });
          } catch (err) {
            log.error('stripe.link_failed', { err: (err as Error).message, userId });
            finalReply = [
              finalReply,
              '',
              '⚠️ ระบบชำระเงินออนไลน์มีปัญหาชั่วคราวครับ',
              'กรุณาโอนเงินและส่ง slip มาที่ LINE นี้',
              'หรือโทร +66 94 269 4651 ครับ',
            ].join('\n');
          }
        }

        // 7. Reply LINE
        await replyWithRetry(event.replyToken!, finalReply, 3);

        log.info('reply.sent', {
          userId,
          latencyMs: Date.now() - startTime,
          replyLength: finalReply.length,
          hasBooking: !!booking,
        });
      } catch (err) {
        log.error('webhook.error', { err: (err as Error).message, userId });
        try {
          await getLineClient().replyMessage(event.replyToken!, {
            type: 'text',
            text: DEFAULT_REPLY,
          });
        } catch {
          /* replyToken expired */
        }
      }
    })
  );

  return new Response('ok', { status: 200 });
}

async function replyWithRetry(
  replyToken: string,
  text: string,
  attempts: number
): Promise<void> {
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
