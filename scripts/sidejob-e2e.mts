// ⚠️ เขียนข้อมูลทดสอบลงชีตจริง (เพื่อน test_owner ใน Owners + งาน TEST-001 ใน Side_Jobs) — ห้ามรันซ้ำโดยไม่ล้างแถวเหล่านี้ทิ้งเอง
// ทดสอบ end-to-end กับชีต "CTT - Side Jobs" จริงผ่าน Apps Script (ข้อมูลสมมติ ไม่มีข้อมูลแขกจริง)
// รัน: npx tsx --env-file=.env.production.local scripts/sidejob-e2e.mts
import assert from 'node:assert/strict';
import { sheetAppendRow } from '../lib/gas-client';
import { lookupPrice, retailPrice } from '../lib/prices';
import { listOwners, resolveOwner, addSideJob, listSideJobs, confirmSideJob, cancelSideJob, buildMonthlySummaries, getSideJob } from '../lib/sidejobs';

const step = (s: string) => console.log(`\n▶ ${s}`);

step('1) เขียนเพื่อนทดสอบลงแท็บ Owners');
const w = await sheetAppendRow('Owners', { owner_id: 'test_owner', display_name: 'เพื่อนทดสอบ', aliases: 'tester,ทดสอบ' }, 'sidejobs');
assert.ok(w.ok, `append Owners failed: ${w.error}`);

step('2) อ่าน Owners + จับชื่อเล่น');
const owners = await listOwners();
assert.equal(resolveOwner('Tester', owners)?.owner_id, 'test_owner');
console.log('   owners ทั้งหมด:', owners.length, 'ราย — จับชื่อเล่น OK');

step('3) บันทึกงานใหม่ (ควรได้ราคาจากตาราง)');
const input = { owner_id: 'test_owner', job_date: '2026-10-15', pickup_time: '09:00', booking_ref: 'TEST-001', guest_name: 'ทดสอบ แขก', pax: 2, origin: 'Krabi Airport', destination: 'Ao Nang', raw_text: 'synthetic test' };
const r1 = await addSideJob(input);
assert.ok(r1.ok, 'addSideJob failed: ' + JSON.stringify(r1));
// ราคาที่ลงสมุดต้องเป็นราคา Agent (ที่เพื่อนจ่ายแชมป์) ไม่ใช่ราคาขายลูกค้า (Agent +15% ปัดร้อย)
const lp = await lookupPrice('Krabi Airport', 'Ao Nang', 2);
assert.equal(lp.status, 'ok');
if (lp.status === 'ok') {
  assert.equal(r1.job.agent_price, String(lp.agentPrice), 'ต้องใช้ agentPrice');
  assert.equal(retailPrice(lp.agentPrice), lp.price, 'retail = Agent*1.15 ปัดร้อย');
  assert.notEqual(lp.agentPrice, lp.price, 'ราคา Agent ต้องไม่เท่าราคาลูกค้า');
  console.log(`   ราคา Agent=${lp.agentPrice} | ราคาลูกค้า=${lp.price} (ลงสมุด=${r1.job.agent_price})`);
}
console.log('   job_id:', r1.job.job_id, '| agent_price:', r1.job.agent_price || '(ว่าง)', r1.priceNote ? `| priceNote: ${r1.priceNote.slice(0, 80)}` : '');

step('4) ส่งซ้ำ (ต้องโดนกันซ้ำ ไม่ลงแถวใหม่)');
const r2 = await addSideJob(input);
assert.ok(!r2.ok && r2.reason === 'duplicate', 'ต้องเป็น duplicate: ' + JSON.stringify(r2));
console.log('   duplicate ของ', r2.existing.job_id, '— OK');

step('5) อ่านกลับ: วันที่/เวลา/pax ต้องไม่เพี้ยนรูปแบบ');
const back = await getSideJob(r1.job.job_id);
assert.ok(back);
console.log('   job_date=%s pickup_time=%s pax=%s status=%s', back.job_date, back.pickup_time, back.pax, back.status);
assert.equal(back.job_date, '2026-10-15');
assert.equal(back.pickup_time, '09:00');
assert.equal(back.pax, '2');
assert.equal(back.status, 'pending');

step('6) ยืนยันขับจริง + ค่าใช้จ่ายเพิ่ม แล้วสรุปเดือน');
const c = await confirmSideJob(r1.job.job_id, 'driven', { extra_cost: 150, extra_note: 'ค่าจอด' });
assert.ok(c.ok, 'confirm failed: ' + c.error);
const out = await buildMonthlySummaries('2026-10', 'test_owner');
console.log(out.join('\n---\n'));
if (r1.job.agent_price) {
  const expected = Number(r1.job.agent_price) + 150;
  assert.ok(out.join().includes(expected.toLocaleString('en-US')), `ยอดรวมควรเป็น ${expected}`);
}

step('7) ยกเลิก (soft delete) แล้วต้องไม่นับในสรุป');
assert.ok((await cancelSideJob(r1.job.job_id)).ok);
const after = await buildMonthlySummaries('2026-10', 'test_owner');
console.log(after.join('\n---\n'));
const all = await listSideJobs();
assert.equal(all.find((j) => j.job_id === r1.job.job_id)?.status, 'cancelled');
console.log('\nE2E ALL OK');
