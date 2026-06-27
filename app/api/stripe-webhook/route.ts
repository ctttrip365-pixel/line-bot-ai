// app/api/stripe-webhook/route.ts — รับ event จาก Stripe เมื่อลูกค้าจ่ายเงิน
// Flow: payment_intent.succeeded → สร้าง Google Calendar + แจ้ง LINE

import Stripe from 'stripe';
import { Client } from '@line/bot-sdk';
import { createCalendarEvent } from '@/lib/calendar';
import { log } from '@/lib/log';

export const runtime = 'nodejs';

// Lazy init — create clients only when needed, not at module load time
function getStripe(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

function getLineClient() {
  return new Client({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
    channelSecret: process.env.LINE_CHANNEL_SECRET!,
  });
}

export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature') || '';

  let event: Stripe.Event;

  // 1. Verify Stripe webhook signature — ป้องกันคนปลอม request
  try {
    event = getStripe().webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    log.warn('stripe.invalid_signature', { err: (err as Error).message });
    return new Response('invalid signature', { status: 400 });
  }

  // 2. Handle payment success เท่านั้น
  if (event.type !== 'checkout.session.completed') {
    return new Response('ok', { status: 200 });
  }

  const session = event.data.object as Stripe.Checkout.Session;

  // ตรวจสอบว่าจ่ายสำเร็จจริงๆ
  if (session.payment_status !== 'paid') {
    log.info('stripe.not_paid_yet', { sessionId: session.id });
    return new Response('ok', { status: 200 });
  }

  // 3. ดึง booking data จาก metadata
  const meta = session.metadata;
  if (!meta?.date || !meta?.time || !meta?.pickup || !meta?.dropoff) {
    log.warn('stripe.missing_metadata', { sessionId: session.id });
    return new Response('ok', { status: 200 });
  }

  const booking = {
    date: meta.date,
    time: meta.time,
    pickup: meta.pickup,
    dropoff: meta.dropoff,
    pax: meta.pax || '1',
    userId: meta.lineUserId || 'unknown',
    amount: meta.amount || '0',
  };

  log.info('stripe.payment_received', {
    sessionId: session.id,
    amount: session.amount_total,
    userId: booking.userId,
    date: booking.date,
  });

  // 4. สร้าง Google Calendar event (ผ่าน Apps Script webhook)
  const calendarOk = await createCalendarEvent(booking);

  // 5. ส่ง LINE push message แจ้งลูกค้าว่าจ่ายแล้ว + จองสมบูรณ์
  if (booking.userId && booking.userId !== 'unknown') {
    try {
      await getLineClient().pushMessage(booking.userId, {
        type: 'text',
        text: [
          '✅ รับเงินเรียบร้อยแล้วครับ!',
          '',
          `📅 ${booking.date} เวลา ${booking.time} น.`,
          `📍 ${booking.pickup} → ${booking.dropoff}`,
          `👥 ${booking.pax} คน`,
          `💰 ${Number(booking.amount).toLocaleString()} บาท`,
          '',
          'พี่แชมป์จะรับท่านตรงเวลานะครับ 🚐',
          'หากต้องการเปลี่ยนแปลง LINE มาได้เลยครับ',
        ].join('\n'),
      });

      log.info('stripe.line_notified', { userId: booking.userId });
    } catch (err) {
      log.error('stripe.line_notify_failed', {
        err: (err as Error).message,
        userId: booking.userId,
      });
    }
  }

  // 6. Push แจ้งพี่แชมป์ด้วย (ใน admin group)
  const adminGroupId = process.env.ADMIN_GROUP_ID;
  if (adminGroupId) {
    try {
      await getLineClient().pushMessage(adminGroupId, {
        type: 'text',
        text: [
          '💰 มีการจองและชำระเงินใหม่!',
          '',
          `📅 ${booking.date} เวลา ${booking.time} น.`,
          `📍 ${booking.pickup} → ${booking.dropoff}`,
          `👥 ${booking.pax} คน | ${Number(booking.amount).toLocaleString()} บาท`,
          `📆 Calendar: ${calendarOk ? 'สร้างแล้ว ✅' : 'ล้มเหลว ❌'}`,
        ].join('\n'),
      });
    } catch {
      /* non-critical */
    }
  }

  return new Response('ok', { status: 200 });
}
