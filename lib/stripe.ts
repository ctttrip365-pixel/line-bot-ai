// lib/stripe.ts — Stripe Checkout Session creator
// Flow: booking confirmed → สร้าง checkout link → ส่งให้ลูกค้าจ่าย

import Stripe from 'stripe';
import { log } from './log';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export interface StripeBookingParams {
  amount: number;       // ราคา เป็น บาท เช่น 600
  date: string;         // DD/MM/YYYY
  time: string;         // HH:MM
  pickup: string;
  dropoff: string;
  pax: string;
  lineUserId: string;
}

/**
 * สร้าง Stripe Checkout Session → คืน URL สำหรับส่งลูกค้า
 * รองรับทั้ง Card และ PromptPay
 */
export async function createCheckoutSession(
  params: StripeBookingParams
): Promise<string> {
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card', 'promptpay'],
    line_items: [
      {
        price_data: {
          currency: 'thb',
          product_data: {
            name: `🚐 CTT Transfer`,
            description: `${params.pickup} → ${params.dropoff} | ${params.date} เวลา ${params.time} น. | ${params.pax} คน`,
          },
          unit_amount: params.amount * 100, // Stripe ใช้ satang (1 บาท = 100 satang)
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    // หลังจ่ายแล้ว redirect กลับ LINE OA CTT
    success_url: 'https://line.me/ti/p/@233wdubx?openExternalBrowser=1',
    cancel_url:  'https://line.me/ti/p/@233wdubx?openExternalBrowser=1',
    // เก็บ booking data ใน metadata → Stripe webhook จะเอาไปสร้าง Calendar
    metadata: {
      date:       params.date,
      time:       params.time,
      pickup:     params.pickup,
      dropoff:    params.dropoff,
      pax:        params.pax,
      lineUserId: params.lineUserId,
      amount:     String(params.amount),
    },
    expires_at: Math.floor(Date.now() / 1000) + 3600, // หมดอายุ 1 ชั่วโมง
  });

  log.info('stripe.session_created', {
    sessionId: session.id,
    amount: params.amount,
    lineUserId: params.lineUserId,
  });

  return session.url!;
}
