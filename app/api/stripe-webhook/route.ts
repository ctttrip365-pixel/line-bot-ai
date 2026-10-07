// app/api/stripe-webhook/route.ts — รับ event จาก Stripe เมื่อลูกค้าจ่ายเงิน
// Flow: payment_intent.succeeded → สร้าง Google Calendar + แจ้ง LINE

import Stripe from 'stripe';
import { Client } from '@line/bot-sdk';
import { createCalendarEvent } from '@/lib/calendar';
import type { BookingDetails } from '@/lib/calendar';
import { claimStripeSession, getPendingBooking, markBookingPaid } from '@/lib/bookings';
import type { PendingBooking } from '@/lib/bookings';
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

  // 3. หา booking data: (ก) Checkout Session ที่เราสร้างเอง → อยู่ใน metadata
  //                      (ข) Stripe Payment Link ประจำเส้นทาง → ค้นจาก client_reference_id ใน Redis
  const meta = session.metadata;
  let booking: BookingDetails | null = null;
  let pending: PendingBooking | null = null;

  if (meta?.date && meta?.time && meta?.pickup && meta?.dropoff) {
    booking = {
      date: meta.date,
      time: meta.time,
      pickup: meta.pickup,
      dropoff: meta.dropoff,
      pax: meta.pax || '1',
      userId: meta.lineUserId || 'unknown',
      amount: meta.amount || '0',
    };
  } else if (session.client_reference_id) {
    pending = await getPendingBooking(session.client_reference_id);
    if (pending) booking = pending;
  }

  const adminGroupId = process.env.ADMIN_GROUP_ID;
  const payer = [session.customer_details?.name, session.customer_details?.phone].filter(Boolean).join(' / ');

  if (!booking) {
    // เงินเข้าแล้วแต่ไม่รู้ว่าจองอะไร — ห้ามเงียบ แจ้งแชมป์ให้ตามเอง
    log.warn('stripe.booking_not_found', { sessionId: session.id, ref: session.client_reference_id });
    if (adminGroupId) {
      try {
        await getLineClient().pushMessage(adminGroupId, {
          type: 'text',
          text: [
            '⚠️ มีเงินเข้า Stripe แต่หารายละเอียดการจองไม่เจอ',
            `ยอด: ${((session.amount_total ?? 0) / 100).toLocaleString()} บาท`,
            `ผู้จ่าย: ${payer || 'ไม่ระบุ'}`,
            `รหัสอ้างอิง: ${session.client_reference_id ?? '-'}`,
            `Stripe session: ${session.id}`,
          ].join('\n'),
        });
      } catch { /* non-critical */ }
    }
    return new Response('ok', { status: 200 });
  }

  // Stripe อาจส่ง event เดิมซ้ำ — ลงงานแค่ครั้งเดียวต่อ session
  if (!(await claimStripeSession(session.id))) {
    log.info('stripe.duplicate_event', { sessionId: session.id });
    return new Response('ok', { status: 200 });
  }

  // จ่ายซ้ำด้วยลิงก์/รหัสอ้างอิงเดิม (ไม่ลงงานซ้ำ แต่ต้องให้แชมป์รู้ว่ามีเงินเข้าอีกก้อน)
  if (pending?.paidSessionId && pending.paidSessionId !== session.id) {
    log.warn('stripe.double_payment', { ref: pending.ref, sessionId: session.id });
    if (adminGroupId) {
      try {
        await getLineClient().pushMessage(adminGroupId, {
          type: 'text',
          text: [
            '⚠️ มีการจ่ายซ้ำสำหรับการจองเดิม',
            `รหัส: ${pending.ref}`,
            `ยอด: ${((session.amount_total ?? 0) / 100).toLocaleString()} บาท`,
            `ผู้จ่าย: ${payer || 'ไม่ระบุ'}`,
            'ยังไม่ได้ลงงานซ้ำ ตรวจสอบเพื่อคืนเงินถ้าจำเป็น',
          ].join('\n'),
        });
      } catch { /* non-critical */ }
    }
    return new Response('ok', { status: 200 });
  }

  log.info('stripe.payment_received', {
    sessionId: session.id,
    amount: session.amount_total,
    userId: booking.userId,
    date: booking.date,
  });

  // 4. สร้าง Google Calendar event (ผ่าน Apps Script webhook)
  const calendarOk = await createCalendarEvent({
    ...booking,
    bookingRef: pending?.ref,
    guestName: session.customer_details?.name ?? undefined,
    phone: session.customer_details?.phone ?? undefined,
  });

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
  if (pending) await markBookingPaid(pending, session.id);
  const amountMismatch =
    pending && session.amount_total != null && session.amount_total !== Number(pending.amount) * 100;
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
          ...(payer ? [`👤 ผู้จ่าย: ${payer}`] : []),
          ...(pending ? [`🔖 รหัส: ${pending.ref}`] : []),
          ...(amountMismatch
            ? [`⚠️ ยอดที่ Stripe รับ (${((session.amount_total ?? 0) / 100).toLocaleString()}) ไม่ตรงกับราคาในระบบ ตรวจสอบด้วย`]
            : []),
          `📆 Calendar: ${calendarOk ? 'สร้างแล้ว ✅' : 'ล้มเหลว ❌'}`,
        ].join('\n'),
      });
    } catch {
      /* non-critical */
    }
  }

  return new Response('ok', { status: 200 });
}
