// scripts/bank-unit.mts — unit test lib/bank.ts (ไม่ใช้ Gemini/Stripe/Redis; ข้อมูลบัญชีเป็นค่าปลอมเท่านั้น)
// รัน: npx tsx scripts/bank-unit.mts
import assert from 'node:assert/strict';

process.env.BANK_TRANSFER_INFO = 'ธนาคารทดสอบ เลขบัญชี 000-0-00000-0 ชื่อบัญชี ทดสอบ ระบบ';
const { applyBankInfo, linkFailureCustomerText, linkFailureAdminText, bankInfoText } = await import('../lib/bank');
const { buildSystemPrompt } = await import('../lib/prompts');

// แทนตัวบอกด้วยค่าจริงตรงทุกตัวอักษร
assert.equal(applyBankInfo('โอนได้เลย\n[BANK_INFO]\nยอด 700'), `โอนได้เลย\n${bankInfoText()}\nยอด 700`);
assert.equal(applyBankInfo('สวัสดี'), 'สวัสดี');

// Gemini ต้องไม่เห็นเลขบัญชีจริงใน prompt (ให้เห็นแค่ตัวบอก)
const prompt = buildSystemPrompt('', 'x', false, 'ไทย', '');
assert.ok(!prompt.includes('000-0-00000-0'));
assert.ok(prompt.includes('[BANK_INFO]'));

// ข้อความตอนลิงก์ล้ม: ภาษาลูกค้า + ข้อมูลโอน + ยอด + ขอสลิป
const th = linkFailureCustomerText('thai', 700);
assert.ok(th.includes('000-0-00000-0') && th.includes('700 บาท') && th.includes('สลิป'));
const en = linkFailureCustomerText('english', 800);
assert.ok(en.includes('000-0-00000-0') && en.includes('800 THB') && /slip/i.test(en) && !/[฀-๿]{3}.*ขออภัย/.test(en.split('\n')[0]));
assert.ok(!/[฀-๿]/.test(en.split('\n')[0])); // บรรทัดนำเป็นอังกฤษล้วน

// ไม่ได้ตั้ง env → ไม่มีเลขบัญชี ให้รอแชมป์ติดต่อกลับ และตัดตัวบอกทิ้ง
delete process.env.BANK_TRANSFER_INFO;
assert.ok(!linkFailureCustomerText('thai', 700).includes('เลขบัญชี'));
assert.ok(linkFailureCustomerText('thai', 700).includes('ติดต่อกลับ'));
assert.equal(applyBankInfo('a\n[BANK_INFO]\nb'), 'a\n\nb');

// ข้อความแจ้งแชมป์: escape HTML และมีรายละเอียดจอง
const admin = linkFailureAdminText({ lang: 'english', amount: 700, err: 'bad <key>', booking: { date: '16/10/2026', time: '15:35', pickup: 'A', dropoff: 'B', pax: '3', phone: '0800000000' }, ref: 'CTT-X', userId: 'U1' });
assert.ok(admin.includes('&lt;key&gt;') && admin.includes('CTT-X') && admin.includes('0800000000'));

console.log('ALL OK');
