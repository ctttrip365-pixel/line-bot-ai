// scripts/booking-event-unit.mts — unit test ตัวกรอง "งานจริง" isBookingEvent (lib/gas-client.ts) ไม่ใช้ Gemini/บริการภายนอก
// รัน: npx tsx scripts/booking-event-unit.mts
import assert from 'node:assert/strict';
import { isBookingEvent } from '../lib/gas-client';

const ev = (summary: string, description = '') => ({ eventId: 'e1', summary, description, start: '2026-11-08T04:00:00.000Z' });

// งาน Daytrip ต้องนับเป็น booking (เดิมหลุด → LINE คนขับแสดง "ไม่มีงาน")
assert.ok(isBookingEvent(ev('Daytrip: PYPJRQQA | Deborah Ansell | Tubkaak→Sarojin Khao Lak | 2 Pax | 11:00')));
assert.ok(isBookingEvent(ev('daytrip: 9JHXU2SL | Rhonda King | A→B | 2 Pax | 12:00')));
assert.ok(isBookingEvent(ev('Daytrip: 4P1TQQVN | Mr.Luke Holland | A→B | 7 Pax | 13:45', 'Driver: Taweerat J.')));

// event อื่นที่แค่พูดถึง Daytrip ห้ามนับ (ผูก ^ กับต้นชื่อ)
assert.equal(isBookingEvent(ev('Book Onboarding Call to activate your account between Daytrip, Alan and sutana saelim')), false);
assert.equal(isBookingEvent(ev('คุยเรื่อง Daytrip: ต่อประกัน')), false);

// ของเดิมต้องไม่เปลี่ยน
assert.ok(isBookingEvent(ev('VTL2982 | Mr.Hajajreh Yazid | IslandEscape→Avani Krabi | 2 Pax | 11:00')));
assert.ok(isBookingEvent(ev('WOA1235 Client Name: Annie GILLOT')));
assert.ok(isBookingEvent(ev('ชื่ออื่น', 'Guest: X\nBooking No: ABC123')));
assert.ok(isBookingEvent(ev('[CTT] อ่าวนาง → สนามบิน | 2 Pax')));
assert.ok(isBookingEvent(ev('CTT-261108-ab12 | Somchai')));
assert.equal(isBookingEvent(ev('ทำบิลเบิก WOA,VIAรายเดือน')), false);
assert.equal(isBookingEvent(ev('OFF')), false);

console.log('booking-event-unit: ผ่านทั้งหมด');
