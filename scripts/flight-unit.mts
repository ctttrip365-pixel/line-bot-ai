// scripts/flight-unit.mts — unit test กติกาขอเที่ยวบิน (lib/calendar.ts) ไม่ใช้ Gemini/บริการภายนอก
// รัน: npx tsx scripts/flight-unit.mts
import assert from 'node:assert/strict';
import { involvesAirport, missingBookingInfo } from '../lib/calendar';

const b = (pickup: string, dropoff: string, phone = '0812345678', flight?: string) =>
  ({ date: '23/10/2026', time: '10:00', pickup, dropoff, pax: '2', userId: 'U1', amount: '700', phone, flight });

// รับจากสนามบิน (เดิม) ยังต้องมีเที่ยวบิน
assert.deepEqual(missingBookingInfo(b('สนามบินกระบี่', 'อ่าวนาง')), ['flight']);
assert.deepEqual(missingBookingInfo(b('Krabi Airport', 'Ao Nang', '0812345678', 'FD3305')), []);
// ส่งไปสนามบิน (เปลี่ยน 19 ต.ค. 2026) ต้องมีเที่ยวบินด้วย
assert.deepEqual(missingBookingInfo(b('De Malee Krabi', 'สนามบินกระบี่')), ['flight']);
assert.deepEqual(missingBookingInfo(b('Avani Krabi', 'Phuket Airport (HKT)', '0812345678', 'FD3306')), []);
// ไม่เกี่ยวกับสนามบิน ไม่ต้องขอเที่ยวบิน
assert.deepEqual(missingBookingInfo(b('Avani Krabi', 'Ao Nang Beach')), []);
// เบอร์โทรยังบังคับทุกครั้ง
assert.deepEqual(missingBookingInfo(b('Avani Krabi', 'Ao Nang Beach', '')), ['phone']);
assert.deepEqual(missingBookingInfo(b('Avani Krabi', 'สนามบินกระบี่', '123')), ['phone', 'flight']);
assert.ok(involvesAirport('hotel', 'KBV') && involvesAirport('HKT', 'hotel') && !involvesAirport('hotel A', 'hotel B'));

console.log('ALL OK');
