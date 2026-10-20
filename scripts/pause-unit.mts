// scripts/pause-unit.mts — unit test ปุ่ม "พักบอท" (ไม่ใช้ Redis/Telegram จริง)
// รัน: npx tsx scripts/pause-unit.mts
import assert from 'node:assert/strict';
import { pauseCallbackData, formatPauseEnd, PAUSE_MINUTES } from '../lib/pause';

assert.equal(PAUSE_MINUTES, 30);

// userId LINE จริง = U + 32 hex → ได้ปุ่ม และยาวไม่เกิน 64 ไบต์ของ Telegram
const uid = 'U' + 'a1b2c3d4'.repeat(4);
assert.equal(pauseCallbackData(uid), `pause:${uid}`);
assert.ok(pauseCallbackData(uid)!.length <= 64);

// ไม่ใช่ userId จริง (เช่น 'unknown') → ไม่สร้างปุ่ม
assert.equal(pauseCallbackData('unknown'), null);
assert.equal(pauseCallbackData(''), null);
assert.equal(pauseCallbackData('U123'), null);

// เวลาสิ้นสุดเป็นเวลาไทย: 05:00Z = 12:00 น. (+07)
assert.match(formatPauseEnd(Date.UTC(2026, 9, 20, 5, 0, 0)), /^12[:.]00$/);

console.log('ALL OK');
