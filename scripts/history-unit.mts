// scripts/history-unit.mts — unit test ตัวกรองข้อความ "ระบบชำระเงินมีปัญหา" ในประวัติที่ส่งให้ Gemini
// รัน: npx tsx scripts/history-unit.mts
import assert from 'node:assert/strict';
import { isPaymentFailureNote } from '../lib/gemini';

// ต้องจับได้: ข้อความล้มจริงของระบบ + ที่ Gemini พูดเองตามประวัติ (ไทย/อังกฤษ)
for (const t of [
  '⚠️ ระบบชำระเงินออนไลน์มีปัญหาชั่วคราวครับ\nกรุณาโอนเงินและส่ง slip มาที่ LINE นี้',
  'ขออภัยครับ ระบบชำระเงินออนไลน์ยังคงมีปัญหาชั่วคราวครับ ตอนนี้ยังไม่สามารถสร้างลิงก์ชำระเงินให้ได้ครับ',
  '⚠️ ขออภัยครับ ระบบสร้างลิงก์ชำระเงินออนไลน์ขัดข้องชั่วคราว พี่แชมป์ได้รับแจ้งแล้วครับ',
  '⚠️ Sorry, our online payment link is temporarily unavailable. Champ has been notified.',
  'My apologies for the message in Thai. It means that our online payment system is temporarily unavailable.',
]) assert.ok(isPaymentFailureNote(t), t);

// ต้องไม่จับ: ข้อความปกติ
for (const t of [
  'สรุปการจองนะครับ 🚐\n💰 ราคา: 700 บาท\nพิมพ์ ยืนยัน เพื่อรับลิงก์ชำระเงินครับ',
  'ชำระเงินได้ที่ลิงก์นี้เลยครับ https://checkout.stripe.com/c/pay/abc',
  'Here is your booking summary. Type "Confirm" to get the payment link.',
  'CTT ไม่รับเงินสด ต้องชำระเต็มจำนวนล่วงหน้าผ่านลิงก์ชำระเงินหรือโอนบัญชีครับ',
]) assert.ok(!isPaymentFailureNote(t), t);

console.log('ALL OK');
