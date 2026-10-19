// scripts/paid-message-unit.mts — unit test ข้อความยืนยันหลังจ่ายเงิน + การอ่านชื่อจาก block (ไม่ใช้ Gemini/บริการภายนอก)
// รัน: npx tsx scripts/paid-message-unit.mts
import assert from 'node:assert/strict';
import { customerPaidText, isKrabiAirportPickup } from '../lib/payment-messages';
import { parseBookingConfirmation } from '../lib/calendar';

const base = { date: '22/10/2026', time: '10:20', pickup: 'Krabi Airport', dropoff: 'Ao Nang', pax: '2', userId: 'U1', amount: '700', guestName: 'Somchai Jaidee', flight: 'FD3230' };

// รับจากสนามบินกระบี่ (ไทย): ต้องมีชื่อ ประตู 15 และขั้นตอนป้ายชื่อ
const th = customerPaidText(base, 'thai');
assert.ok(th.includes('ชื่อผู้โดยสาร: Somchai Jaidee'));
assert.ok(th.includes('ประตูทาง 15') && th.includes('เขียนชื่อ "Somchai Jaidee" ลงป้าย') && th.includes('ถือป้ายชื่อ'));
assert.ok(th.includes('FD3230') && th.includes('700 บาท'));

// อังกฤษ: ภาษาอังกฤษล้วน ไม่มีตัวไทย
const en = customerPaidText({ ...base }, 'english');
assert.ok(!/[฀-๿]/.test(en), 'ข้อความอังกฤษต้องไม่มีตัวไทย');
assert.ok(en.includes('Gate 15') && en.includes('"Somchai Jaidee"') && en.includes('name board') && en.includes('700 THB'));
assert.equal(customerPaidText(base, 'other'), en); // ภาษาอื่น → อังกฤษ

// ไม่ได้รับจากสนามบินกระบี่ (โรงแรม→สนามบิน): ไม่มีประตู 15/ป้ายชื่อ แต่ยังมีชื่อผู้โดยสาร
const hotel = customerPaidText({ ...base, pickup: 'De Malee Krabi', dropoff: 'Krabi Airport' }, 'thai');
assert.ok(!hotel.includes('ประตูทาง 15') && !hotel.includes('ป้าย') && hotel.includes('Somchai Jaidee'));
assert.ok(isKrabiAirportPickup('สนามบินกระบี่') && isKrabiAirportPickup('KBV') && !isKrabiAirportPickup('Phuket Airport'));

// ไม่มีชื่อ (จองก่อนระบบขอชื่อ): ข้อความยังใช้ได้ ไม่มี "undefined"
const noName = customerPaidText({ ...base, guestName: undefined }, 'thai');
assert.ok(!noName.includes('undefined') && noName.includes('เขียนชื่อท่านลงป้าย'));

// parse: name= ใน block → guestName
const block = '[BOOKING_CONFIRMED]\ndate=22/10/2026\ntime=10:20\npickup=Krabi Airport\ndropoff=Ao Nang\npax=2\namount=700\nname=Somchai Jaidee\nphone=0812345678\nflight=FD3230\n[/BOOKING_CONFIRMED]';
const parsed = parseBookingConfirmation(block, 'U1');
assert.equal(parsed?.guestName, 'Somchai Jaidee');
assert.equal(parseBookingConfirmation(block.replace('name=Somchai Jaidee\n', ''), 'U1')?.guestName, undefined);

console.log('ALL OK');
