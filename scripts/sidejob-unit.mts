// ทดสอบฟังก์ชันล้วน (ไม่แตะชีต/เครือข่าย) ของ lib/sidejobs.ts ด้วยข้อมูลสังเคราะห์
import assert from 'node:assert/strict';
import { resolveOwner, buildOwnerSummary, dedupeKey, jobsAwaitingConfirmation, previousMonth, monthLabelTh, parseSummaryArgs, parseExtra, type SideJob, type Owner } from '../lib/sidejobs';

const owners: Owner[] = [{ owner_id: 'friend_a', display_name: 'เพื่อน เอ', aliases: 'เอ, A ,เอน้อย' }];
assert.equal(resolveOwner('เอ', owners)?.owner_id, 'friend_a');
assert.equal(resolveOwner(' a ', owners)?.owner_id, 'friend_a');
assert.equal(resolveOwner('ไม่รู้จัก', owners), null);
assert.equal(resolveOwner('', owners), null);

const base: SideJob = { job_id: 'x', owner_id: 'friend_a', job_date: '2026-10-05', pickup_time: '09:00', booking_ref: 'T1', guest_name: '', pax: '2', origin: 'Krabi Airport', destination: 'Ao Nang', agent_price: '700', extra_cost: '', extra_note: '', status: 'driven', source_file_ids: '', raw_text: '', created_at: '', confirmed_at: '', telegram_card_msg_id: '' };
const jobs: SideJob[] = [
  base,
  { ...base, job_id: 'y', job_date: '2026-10-12', booking_ref: 'T2', agent_price: '1,200', extra_cost: '150', extra_note: 'ค่าจอด' },
  { ...base, job_id: 'z', job_date: '2026-10-20', booking_ref: 'T3', status: 'pending' },
  { ...base, job_id: 'w', job_date: '2026-10-21', booking_ref: 'T4', status: 'not_driven' },
  { ...base, job_id: 'v', job_date: '2026-10-22', booking_ref: 'T5', status: 'cancelled' },
  { ...base, job_id: 'u', job_date: '2026-10-23', booking_ref: 'T6', agent_price: '' },
  { ...base, job_id: 't', job_date: '2026-09-30', booking_ref: 'T7' },
];
const out = buildOwnerSummary(jobs, owners[0], '2026-10');
console.log(out.join('\n---\n'));
assert.match(out[0], /รวม 2 งาน = 2,050 บาท/); // T1 700 + T2 (1200+150); T6 ไม่มีราคา ไม่อยู่ในก้อนส่งเพื่อน
assert.ok(!out[0].includes('T6') && !out[0].includes('ยังไม่มีราคา'));
assert.ok(out.some((c) => c.includes('ยังไม่ได้ยืนยัน 1 งาน')));
assert.ok(out.some((c) => c.includes('ยังไม่มีราคา 1 งาน') && c.includes('T6')));
assert.ok(!out.join().includes('T7') && !out.join().includes('T4') && !out.join().includes('T5'));

assert.equal(dedupeKey({ owner_id: 'a', booking_ref: 'VTL 3036', job_date: 'd', origin: 'Krabi Airport', destination: 'Ao-Nang' }), dedupeKey({ owner_id: 'a', booking_ref: 'vtl3036', job_date: 'd', origin: 'krabi airport', destination: 'ao nang' }));
assert.equal(jobsAwaitingConfirmation(jobs, '2026-10-21').map((j) => j.job_id).join(), 'z');
assert.equal(previousMonth(Date.parse('2026-11-01T02:00:00Z')), '2026-10');
assert.equal(previousMonth(Date.parse('2027-01-01T02:00:00Z')), '2026-12');
assert.equal(monthLabelTh('2026-10'), 'ตุลาคม 2569');
// ---- parseSummaryArgs (วันนี้สมมติ 2026-10-11)
const NOW = Date.parse('2026-10-11T02:00:00Z');
const ok = (a: string) => { const r = parseSummaryArgs(a, owners, NOW); assert.ok(r.ok, a + ' => ' + JSON.stringify(r)); return r as Extract<typeof r, { ok: true }>; };
assert.equal(ok('').month, '2026-10'); assert.equal(ok('').owner, null);
assert.equal(ok('เอ').owner?.owner_id, 'friend_a');
assert.equal(ok('ต.ค.').month, '2026-10');
assert.equal(ok('ตุลาคม 2569').month, '2026-10');
assert.equal(ok('เอ กันยายน').month, '2026-09'); assert.equal(ok('เอ กันยายน').owner?.owner_id, 'friend_a');
assert.equal(ok('กย เอ').month, '2026-09');
assert.equal(ok('2026-09').month, '2026-09');
assert.equal(ok('9').month, '2026-09');
assert.equal(ok('ธ.ค.').month, '2025-12', 'เดือนที่ยังไม่มาถึงในปีนี้ (ไม่ระบุปี) = ปีก่อน');
assert.equal(ok('ธ.ค. 2569').month, '2026-12', 'ระบุปีชัด = ตามนั้น');
assert.equal(ok('Oct').month, '2026-10');
assert.ok(!parseSummaryArgs('คนแปลกหน้า', owners, NOW).ok);
assert.ok(!parseSummaryArgs('2026-13', owners, NOW).ok);

// ---- parseExtra
assert.deepEqual(parseExtra('150'), { cost: 150, note: '' });
assert.deepEqual(parseExtra('150 ค่าจอด'), { cost: 150, note: 'ค่าจอด' });
assert.deepEqual(parseExtra('ค่าจอด 1,250 บาท'), { cost: 1250, note: 'ค่าจอด' });
assert.equal(parseExtra('VTL3036'), null, 'ตัวเลขติดตัวอักษร ไม่ใช่เงิน');
assert.equal(parseExtra('ค่าจอด 100 ทางด่วน 50'), null, 'หลายตัวเลข = กำกวม');
assert.equal(parseExtra('ไม่มีตัวเลข'), null);
assert.equal(parseExtra('0'), null);
console.log('ALL OK');
