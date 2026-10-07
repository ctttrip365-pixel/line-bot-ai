// app/api/line-webhook/route.ts — Production webhook handler
// v4: Redis-backed 48h conversation history — bot จำบทสนทนาไม่ลืมแม้ Vercel cold start

import { after } from 'next/server';
import { Client, validateSignature, WebhookEvent } from '@line/bot-sdk';
import { generateReply, DEFAULT_REPLY, DEFAULT_REPLY_EN } from '@/lib/gemini';
import { shouldHandoff, notifyAdmin } from '@/lib/handoff';
import { detectLanguage } from '@/lib/language';
import { parseBookingConfirmation, cleanReply } from '@/lib/calendar';
import { createCheckoutSession } from '@/lib/stripe';
import { lookupPrice } from '@/lib/prices';
import { newBookingRef, savePendingBooking } from '@/lib/bookings';
import { getHistory, appendHistory } from '@/lib/history';
import { findDriverByLineId, driverRosterUnavailable } from '@/lib/drivers';
import { handleDriverMessage, handleDriverPostback } from '@/lib/driver-flow';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
// bumped from 30s — the avail:submit handler's after() now runs runDispatchMatch() over a much
// wider Calendar window (rollingDateRange(), ~2 months instead of 14 days), which can take longer
// than 30s given Apps Script's cold-start latency on each call; the LINE reply itself is already
// sent long before this, so raising this only extends how long the background work gets to finish
export const maxDuration = 60;

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
      const userId = event.source.userId || 'unknown';

      // --- Driver routing: checked FIRST, before anything Gemini/customer-related.
      // Known drivers (Sheet "Drivers", cached) never touch the sales AI at all —
      // this is a deliberate structural separation, not just a keyword filter, so
      // there's no risk of driver traffic ever mixing with customer chat handling.
      if (event.type === 'postback') {
        const driver = await findDriverByLineId(userId);
        if (driver) await handleDriverPostback(driver, event.postback.data, event.replyToken);
        return; // postbacks from non-drivers are ignored entirely (none are sent to customers today)
      }

      if (event.type !== 'message' || event.message.type !== 'text') return;

      const userMessage = event.message.text;

      const driver = await findDriverByLineId(userId);
      if (driver) {
        await handleDriverMessage(driver, userMessage, event.replyToken!);
        return;
      }

      // อ่านรายชื่อคนขับไม่ได้เลย (Apps Script ล่ม/ช้า และไม่มีสำเนา) ทั้งที่ข้อความมีคำสั่งของคนขับ → อย่าส่งเข้าบอทลูกค้า
      // (เคยเกิด 2026-10-07: แชมป์พิมพ์ "วันว่าง" แล้วได้ข้อความ "ขอเวลาเช็ค" ของลูกค้า) ให้บอกให้ส่งใหม่แทน
      if (driverRosterUnavailable() && /วันว่าง|เช็คงาน|ขอลา/.test(userMessage)) {
        log.warn('driver.roster_unavailable_keyword', { userId });
        await replyWithRetry(event.replyToken!, 'ระบบกำลังโหลดข้อมูลคนขับ ขอเวลาสักครู่ แล้วส่งข้อความนี้อีกครั้งนะครับ 🙏', 3);
        return;
      }

      const startTime = Date.now();

      try {
        if (shouldHandoff(userMessage)) {
          await notifyAdmin(userId, userMessage, 'ลูกค้าขอคุยกับคน / คืนเงิน / ยกเลิก / ย้ายวัน / ร้องเรียน');
          const handoffText =
            detectLanguage(userMessage) === 'thai'
              ? 'ขอแจ้งพี่แชมป์ติดต่อกลับนะครับ 🙏'
              : "I'll let Champ know and we'll get back to you shortly 🙏";
          await replyWithRetry(event.replyToken!, handoffText, 3);
          log.info('handoff.routed', { userId, latencyMs: Date.now() - startTime });
          return;
        }

        // FAQ ไม่ถูกดึงทั้งชีตมาใส่ prompt แล้ว — Gemini ค้นเฉพาะแถวที่ต้องใช้ผ่าน tool search_faq (lib/faq.ts)
        const history = await getHistory(userId);

        const rawReply = await Promise.race([
          generateReply(userMessage, '', history),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('gemini_timeout')), 18000)
          ),
        ]).catch((err) => {
          log.error('gemini.failed', { err: err.message, userId });
          // ลูกค้าได้ข้อความ "ขอเวลาเช็ค" — ต้องแจ้งแชมป์ (LINE + Telegram) ให้ตอบเอง ไม่ปล่อยให้ลูกค้าถูกทิ้งเงียบๆ
          after(() =>
            notifyAdmin(
              userId,
              userMessage,
              'บอทตอบไม่ได้ (Gemini ล้มเหลว/ช้า/ตอบว่าง) — ลูกค้าได้ข้อความ "ขอเวลาเช็ค" โปรดตอบลูกค้าเอง'
            ).catch(() => {})
          );
          return detectLanguage(userMessage) === 'thai' ? DEFAULT_REPLY : DEFAULT_REPLY_EN;
        });

        // Gemini ใส่ [HANDOFF] เมื่อหาราคาไม่ได้/เกิน 8 คน → แจ้งแชมป์ (ลูกค้าไม่เห็น marker เพราะ cleanReply ตัดออก)
        if (rawReply.includes('[HANDOFF]')) {
          await notifyAdmin(userId, userMessage, 'บอทส่งต่อ: ตอบเองไม่ได้ (ไม่มีราคา/ไม่มีใน FAQ/ต้องให้คนตัดสินใจ)');
        }

        const booking = parseBookingConfirmation(rawReply, userId);
        let finalReply = cleanReply(rawReply);

        // Gemini พิมพ์ block จองแต่ข้อมูลไม่ครบ (เช่น ไม่มีวันที่) → อ่านไม่ได้ จึงไม่มีลิงก์ชำระเงิน
        // ลบ block ที่เสียออก แล้วขอข้อมูลที่ขาดแทน ไม่ปล่อยให้ลูกค้ารอลิงก์ที่ไม่มีวันมา
        if (!booking && rawReply.includes('[BOOKING_CONFIRMED]')) {
          log.warn('booking.incomplete_block', { userId });
          finalReply = finalReply
            .replace(/\[BOOKING_CONFIRMED\][\s\S]*?(\[\/BOOKING_CONFIRMED\]|$)/g, '')
            .trim();
          finalReply = [
            finalReply,
            '',
            'รบกวนแจ้งวันที่ เวลารับ จุดรับ จุดส่ง และจำนวนคนให้ครบอีกครั้งนะครับ 🙏',
            'Please send the date, pick-up time, pick-up/drop-off places and number of passengers.',
          ].join('\n').trim();
        }

        if (booking) {
          log.info('booking.confirmed', {
            userId, date: booking.date, time: booking.time,
            pickup: booking.pickup, dropoff: booking.dropoff,
            pax: booking.pax, amount: booking.amount,
          });

          try {
            // ราคาให้เซิร์ฟเวอร์ค้นเองจากชีต ไม่เชื่อตัวเลขที่ Gemini เขียนมาในบล็อก (เดิมไม่มีราคา = เก็บ 600)
            const priced = await lookupPrice(booking.pickup, booking.dropoff, Number(booking.pax));
            if (priced.status !== 'ok') {
              log.warn('booking.no_price', { userId, status: priced.status, pickup: booking.pickup, dropoff: booking.dropoff });
              await notifyAdmin(
                userId,
                `ลูกค้ายืนยันจองแต่หาราคาไม่ได้: ${booking.pickup} → ${booking.dropoff}, ${booking.pax} คน, ${booking.date} ${booking.time}`,
                'ลูกค้ายืนยันจองแต่ไม่มีราคาเส้นทางนี้ — ต้องยืนยันราคา'
              );
              finalReply = [finalReply, '', 'ขอให้พี่แชมป์ยืนยันราคาให้ก่อนนะครับ แล้วจะส่งลิงก์ชำระเงินให้เลยครับ 🙏'].join('\n');
            } else {
              const amount = priced.price;
              let paymentUrl: string;
              let footer: string;
              if (priced.paymentLink) {
                // Stripe Payment Link ประจำเส้นทาง (ราคาถูกล็อกไว้ที่ลิงก์) — เก็บรายละเอียดจองไว้ฝั่งเรา
                // แล้วให้ webhook ค้นกลับด้วย client_reference_id
                const ref = newBookingRef();
                await savePendingBooking({ ...booking, amount: String(amount), ref });
                paymentUrl = `${priced.paymentLink}?client_reference_id=${ref}`;
                footer = '📝 กรอกชื่อและเบอร์โทรในหน้าชำระเงินด้วยนะครับ';
                log.info('stripe.payment_link_used', { userId, ref, amount });
              } else {
                paymentUrl = await createCheckoutSession({
                  amount, date: booking.date, time: booking.time,
                  pickup: booking.pickup, dropoff: booking.dropoff,
                  pax: booking.pax, lineUserId: userId,
                });
                footer = '⏱ ลิงก์หมดอายุใน 1 ชั่วโมง';
                log.info('stripe.link_created', { userId, amount });
              }
              finalReply = [
                finalReply, '',
                '💳 ชำระเงินได้ที่ลิงก์นี้เลยครับ:',
                paymentUrl, '',
                footer,
                'หลังชำระแล้วจะได้รับการยืนยันทาง LINE ทันทีเลยครับ',
              ].join('\n');
            }
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

        // บันทึก history หลังตอบลูกค้าเรียบร้อย — ใช้ after() เพื่อให้ทำงานจนจบ
        // ก่อน Vercel จะ freeze function (fire-and-forget เฉยๆ จะโดนตัดก่อนเขียน Redis เสร็จ)
        after(() => appendHistory(userId, userMessage, finalReply).catch(() => {}));

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
