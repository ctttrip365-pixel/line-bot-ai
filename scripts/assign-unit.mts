// scripts/assign-unit.mts — unit test ข้อความยืนยันคนขับ: สถานะปฏิทิน + เตือนเมื่อสวนกับคนที่เพิ่งเปลี่ยน
// ไม่แตะบริการจริง: Apps Script / Telegram ถูก stub (ข้อมูลทั้งหมดเป็นของปลอม)
// รัน: npx tsx scripts/assign-unit.mts
import assert from 'node:assert/strict';

process.env.CALENDAR_WEBHOOK_URL = 'http://gas.fake/exec';
process.env.TELEGRAM_BOT_TOKEN = 'SIMTOKEN';
process.env.TELEGRAM_CHAMP_CHAT_ID = '999';

let rows: Record<string, string>[] = [];
let calendarOk = true;
const telegram: string[] = [];
const gasActions: string[] = [];
globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
  const url = String(input);
  const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.includes('api.telegram.org')) {
    if (url.endsWith('/sendMessage')) telegram.push(JSON.parse(init!.body!).text);
    return json({ ok: true, result: { message_id: 1 } });
  }
  if (url.startsWith('http://gas.fake')) {
    const b = JSON.parse(init!.body!);
    gasActions.push(b.action);
    if (b.action === 'sheet_read') return json({ ok: true, data: b.tab === 'Assignments_Log' ? rows : [] });
    if (b.action === 'sheet_update') return json({ ok: true });
    if (b.action === 'calendar_update_driver') return calendarOk ? json({ ok: true }) : json({ ok: false, error: 'boom' });
  }
  return json({ ok: true });
}) as typeof fetch;

const { confirmAssignment, confirmStatusLines, humanAgo } = await import('../lib/assignments');

// ---------- ฟังก์ชันจัดรูปแบบ
assert.equal(humanAgo(5 * 60000), '5 นาที');
assert.equal(humanAgo((2 * 60 + 8) * 60000), '2 ชม. 8 นาที');
assert.equal(humanAgo(3 * 3600000), '3 ชม.');
assert.deepEqual(confirmStatusLines({ replacedNotified: false, calendarOk: true }, 'Nes'), ['📆 ปฏิทิน: เขียนชื่อคนขับแล้ว ✅']);
assert.ok(confirmStatusLines({ replacedNotified: false, calendarOk: false }, 'Nes')[0].includes('ไม่สำเร็จ'));
const warn = confirmStatusLines(
  { replacedNotified: false, calendarOk: true, recentChange: { fromName: 'Nes', confirmedAtMs: Date.parse('2026-10-19T12:55:00Z') } },
  'Champ',
  Date.parse('2026-10-19T14:03:00Z')
);
assert.equal(warn.length, 2);
assert.ok(warn[1].includes('เพิ่งยืนยัน Nes') && warn[1].includes('1 ชม. 8 นาทีที่แล้ว') && warn[1].includes('19:55') && warn[1].includes('เปลี่ยนเป็น Champ'));

// ---------- confirmAssignment จริง (stub GAS)
const base = { booking_event_id: 'EV1', calendar_id: 'x', status: 'confirmed', job_date: '2026-10-20', job_start_time: '14:00', proposed_at: '', notified_at: '' };
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

// (1) เปลี่ยนจาก nes → champ ภายใน 70 นาที: ต้องเตือน + เขียนปฏิทินสำเร็จ
rows = [{ ...base, driver_id: 'nes', confirmed_at: ago(70 * 60000) }];
let r = await confirmAssignment('EV1', 'champ', 'Champ');
assert.equal(r.calendarOk, true);
assert.ok(r.recentChange, 'ต้องเตือนเมื่อสวนกับคนที่เพิ่งยืนยันภายใน 24 ชม.');
assert.ok(confirmStatusLines(r, 'Champ').some((l) => l.includes('เพิ่งยืนยัน')));

// (2) คนขับเดิมถูกยืนยันไว้ 3 วันก่อน: ไม่เตือน
rows = [{ ...base, driver_id: 'nes', confirmed_at: ago(3 * 24 * 3600000) }];
r = await confirmAssignment('EV1', 'champ', 'Champ');
assert.equal(r.recentChange, undefined);

// (3) ยืนยันคนเดิมซ้ำ (ไม่ได้เปลี่ยนคน): ไม่เตือน
rows = [{ ...base, driver_id: 'nes', confirmed_at: ago(5 * 60000) }];
r = await confirmAssignment('EV1', 'nes', 'Nes');
assert.equal(r.recentChange, undefined);

// (4) เขียนปฏิทินล้ม: calendarOk=false + ข้อความเตือนแยกถึงแชมป์ + ลองซ้ำ 1 ครั้ง
calendarOk = false;
gasActions.length = 0;
telegram.length = 0;
rows = [{ ...base, driver_id: 'nes', confirmed_at: ago(3 * 24 * 3600000) }];
r = await confirmAssignment('EV1', 'champ', 'Champ');
assert.equal(r.calendarOk, false);
assert.equal(gasActions.filter((a) => a === 'calendar_update_driver').length, 2);
assert.ok(telegram.some((t) => t.includes('เขียนชื่อคนขับลงปฏิทินไม่สำเร็จ')));

console.log('ALL OK');
