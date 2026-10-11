// จำลองทั้งสายรับงานของ Side Jobs โดยไม่ส่งข้อความจริงเข้า Telegram ของแชมป์
//  - Telegram Bot API: ถูก stub ใน process (จับข้อความ/ปุ่มที่บอทจะส่ง)
//  - Redis: เซิร์ฟเวอร์จำลองในเครื่อง (พูดภาษา Upstash REST) — ไฟล์ env ในเครื่องซ่อนค่า Redis จริงไว้
//  - Gemini: ตัวอ่านปลอมที่ตอบตามสคริปต์ (ไม่ได้ทดสอบความแม่นของ AI อ่านรูป — ต้องมี GEMINI_API_KEY จริง)
//  - ชีต Side Jobs + Apps Script: ของจริง! (สร้างแถว SIM-* ในชีตจริง แล้วยกเลิก status=cancelled ตอนท้าย — ต้องลบแถวเองในชีต)
// รัน: npx tsx --env-file=.env.production.local scripts/sidejob-sim.mts
import http from 'node:http';
import assert from 'node:assert/strict';

// ---------- Redis จำลอง (Upstash REST: POST body = ["CMD", args...]; ตอบ base64 ตาม header) ----------
const kv = new Map<string, unknown>();
const enc = (v: unknown): unknown => (typeof v === 'string' ? Buffer.from(v).toString('base64') : Array.isArray(v) ? v.map(enc) : v);
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const b64 = String(req.headers['upstash-encoding'] ?? '') === 'base64';
    const run = (cmd: string[]): unknown => {
      const [c, key, ...args] = cmd;
      switch (c.toUpperCase()) {
        case 'SET': {
          const nx = args.map((a) => String(a).toUpperCase()).includes('NX');
          if (nx && kv.has(key)) return null;
          kv.set(key, args[0]);
          return 'OK';
        }
        case 'GET': return kv.has(key) ? kv.get(key) : null;
        case 'RPUSH': { const l = (kv.get(key) as string[]) ?? []; l.push(...args); kv.set(key, l); return l.length; }
        case 'LRANGE': return (kv.get(key) as string[]) ?? [];
        case 'EXPIRE': return 1;
        case 'DEL': kv.delete(key); return 1;
        default: return null;
      }
    };
    const parsed = JSON.parse(body);
    const out = req.url?.includes('pipeline') ? (parsed as string[][]).map((c) => ({ result: b64 ? enc(run(c)) : run(c) })) : { result: b64 ? enc(run(parsed)) : run(parsed) };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(out));
  });
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;
process.env.KV_REST_API_URL = `http://127.0.0.1:${port}`;
process.env.KV_REST_API_TOKEN = 'sim';
process.env.UPSTASH_REDIS_REST_URL = '';
process.env.UPSTASH_REDIS_REST_TOKEN = '';

// ---------- Telegram stub ----------
process.env.TELEGRAM_BOT_TOKEN = 'SIMTOKEN';
process.env.TELEGRAM_CHAMP_CHAT_ID = '999';
interface Sent { kind: 'send' | 'edit'; mid: number; text: string; buttons: Array<Array<{ text: string; callback_data: string }>> | undefined }
const sent: Sent[] = [];
let midCounter = 1000;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
  const url = String(input);
  if (!url.includes('api.telegram.org')) return realFetch(input as never, init as never);
  const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.includes('/file/bot')) return new Response(Buffer.from('fake-bytes'), { status: 200 });
  const method = url.split('/').pop()!;
  const body = init?.body ? JSON.parse(init.body) : {};
  if (method === 'sendMessage') {
    const mid = ++midCounter;
    sent.push({ kind: 'send', mid, text: body.text, buttons: body.reply_markup?.inline_keyboard });
    return json({ ok: true, result: { message_id: mid } });
  }
  if (method === 'editMessageText') {
    sent.push({ kind: 'edit', mid: body.message_id, text: body.text, buttons: body.reply_markup?.inline_keyboard });
    return json({ ok: true, result: true });
  }
  if (method === 'getFile') return json({ ok: true, result: { file_path: 'photos/f.jpg', file_size: 100 } });
  return json({ ok: true, result: true });
}) as typeof fetch;

const { routeSideJobMessage, handleSideJobCallback } = await import('../lib/sidejob-intake');
const { listSideJobs, cancelSideJob, listOwners } = await import('../lib/sidejobs');
// ชื่อเพื่อนมาจากแท็บ Owners ในชีตจริง (ห้ามฝังชื่อจริงในไฟล์ — repo เป็น PUBLIC) ต้องมีอย่างน้อย 3 คน
const realOwners = await listOwners();
assert.ok(realOwners.length >= 3, 'แท็บ Owners ต้องมีเพื่อนอย่างน้อย 3 คนเพื่อรันสคริปต์นี้');
const [O1, O2, O3] = realOwners;
const re = (o: { display_name: string }) => new RegExp(o.display_name);
const { sendSideJobConfirmations, sendMonthlySummariesIfFirstDay, handleSummaryCommand } = await import('../lib/sidejob-daily');
type Extractor = Parameters<typeof routeSideJobMessage>[1];

// ---------- Gemini ปลอม: ตอบตามตัวอักษรชี้สถานการณ์ในข้อความ ----------
const extractCalls: Array<{ text: string; files: number }> = [];
const job = (o: Record<string, unknown>) => ({ owner_hint: '', booking_ref: '', guest_name: 'Sim Guest', pax: 2, date: '2026-11-18', time: '14:30', origin: 'Krabi Airport', destination: 'Ao Nang', ...o });
const fake: Extractor = async (opts) => {
  extractCalls.push({ text: opts.text, files: opts.files.length });
  const t = opts.text;
  if (t.includes('[A]')) return { jobs: [job({ booking_ref: 'SIM-A1' })] };
  if (t.includes('[B]')) return { jobs: [job({ booking_ref: 'SIM-B1', date: '2026-11-19' })] };
  if (t.includes('[C]')) return { jobs: [job({ booking_ref: 'SIM-C1', date: t.includes('ข้อมูลที่แชมป์เติมให้') ? '2026-11-20' : null })] };
  if (t.includes('[D]')) return { jobs: [job({ booking_ref: 'SIM-D1', date: '2026-11-21', origin: 'Nowhere Hotel XYZ', destination: 'Unknown Beach Town' })] };
  if (t.includes('[F]')) return { jobs: [job({ booking_ref: 'SIM-F1', date: '2026-10-01' })] };
  if (t.includes('[G]')) return { jobs: [job({ booking_ref: 'SIM-G1', date: '2026-10-02' })] };
  if (t.includes('[H]')) return { jobs: [job({ booking_ref: 'SIM-H1', date: '2026-10-03' })] };
  if (t.includes('[E]')) return { jobs: [job({ booking_ref: 'SIM-E1', date: '2026-11-22' })] };
  return { jobs: [] };
};

const step = (s: string) => console.log(`\n▶ ${s}`);
let upd = 0;
const msg = (o: Record<string, unknown>) => ({ message_id: ++upd + 5000, chat: { id: 999 }, ...o }) as never;
const last = () => sent[sent.length - 1];
const since = (n: number) => sent.slice(n);
// นับเฉพาะแถวที่สร้างในรอบนี้ (แถว SIM-* เก่าจากรอบที่ล้มอาจค้างในชีต สถานะยกเลิก — ต้องไม่ปนกัน)
const RUN_START = new Date().toISOString();
const rows = async () => (await listSideJobs()).filter((j) => j.booking_ref.startsWith('SIM-') && j.created_at >= RUN_START);

try {
  step('S1 ส่งข้อความ "จากเพื่อน A: [A]" → บันทึก + การ์ด (เจ้าของ=เพื่อน A ราคา Agent 600)');
  let n = sent.length;
  await routeSideJobMessage(msg({ text: `จาก${O1.display_name}: [A] ข้อความทดสอบ` }), fake);
  const s1 = since(n);
  assert.equal(s1.length, 1, 'ควรได้การ์ด 1 ใบ: ' + JSON.stringify(s1.map((x) => x.text)));
  assert.match(s1[0].text, /บันทึกแล้ว/); assert.match(s1[0].text, re(O1)); assert.match(s1[0].text, /600/);
  assert.ok(s1[0].buttons?.flat().some((b) => b.callback_data.startsWith('sj_cancel:')));
  const a1 = (await rows()).find((j) => j.booking_ref === 'SIM-A1')!;
  assert.equal(a1.owner_id, O1.owner_id); assert.equal(a1.agent_price, '600'); assert.equal(a1.job_date, '2026-11-18');
  assert.ok(!extractCalls[0].text.startsWith('จาก' + O1.display_name), 'ต้องตัดชื่อนำหน้าออกก่อนส่ง AI');
  const cardA = s1[0];
  console.log('   OK — job', a1.job_id, 'owner', a1.owner_id, 'price', a1.agent_price);

  step('S2 ส่งซ้ำ → เตือนซ้ำ ไม่ลงแถวใหม่');
  n = sent.length;
  await routeSideJobMessage(msg({ text: `จาก${O1.display_name}: [A] ข้อความทดสอบ` }), fake);
  assert.match(last().text, /ไม่ได้ลงซ้ำ/);
  assert.equal((await rows()).filter((j) => j.booking_ref === 'SIM-A1').length, 1);
  console.log('   OK');

  step('S3 ไม่ระบุเจ้าของ → ถามด้วยปุ่ม แล้วกดเลือกเพื่อน B → บันทึก');
  n = sent.length;
  await routeSideJobMessage(msg({ text: '[B] ไม่บอกชื่อเพื่อน' }), fake);
  const ask = last();
  assert.match(ask.text, /งานนี้ของใคร/);
  const pickBtn = ask.buttons!.flat().find((b) => b.text === O2.display_name)!;
  assert.ok(pickBtn && pickBtn.callback_data.startsWith('sj_pick:'));
  assert.equal((await rows()).filter((j) => j.booking_ref === 'SIM-B1').length, 0, 'ยังไม่บันทึกก่อนเลือกเจ้าของ');
  await handleSideJobCallback({ id: 'c1', data: pickBtn.callback_data, message: { chat: { id: 999 }, message_id: ask.mid } }, fake);
  const b1 = (await rows()).find((j) => j.booking_ref === 'SIM-B1')!;
  assert.equal(b1.owner_id, O2.owner_id);
  assert.match(sent.filter((x) => x.kind === 'send').pop()!.text, re(O2));
  console.log('   OK — owner', b1.owner_id);

  step('S4 ข้อมูลไม่ครบ (ไม่มีวันที่) → ไม่บันทึก + ถามกลับ → reply เติมวันที่ → บันทึก');
  await routeSideJobMessage(msg({ text: `จาก${O3.display_name}: [C]` }), fake);
  const askC = last();
  assert.match(askC.text, /ข้อมูลไม่ครบ/); assert.match(askC.text, /วันที่/);
  assert.equal((await rows()).filter((j) => j.booking_ref === 'SIM-C1').length, 0);
  await routeSideJobMessage(msg({ text: 'วันที่ 20/11', reply_to_message: { message_id: askC.mid } }), fake);
  const c1 = (await rows()).find((j) => j.booking_ref === 'SIM-C1')!;
  assert.ok(c1, 'ควรบันทึกหลังเติมวันที่'); assert.equal(c1.owner_id, O3.owner_id); assert.equal(c1.job_date, '2026-11-20');
  console.log('   OK — owner', c1.owner_id, 'date', c1.job_date);

  step('S5 reply ตัวเลขที่การ์ด → แก้ราคา (การ์ดถูกแก้ + มีข้อความยืนยัน)');
  n = sent.length;
  await routeSideJobMessage(msg({ text: '900', reply_to_message: { message_id: cardA.mid } }), fake);
  const s5 = since(n);
  assert.ok(s5.some((x) => x.kind === 'edit' && x.mid === cardA.mid && /900/.test(x.text)), 'ต้องแก้การ์ดเดิม');
  assert.ok(s5.some((x) => x.kind === 'send' && /แก้แล้ว/.test(x.text)));
  assert.equal((await rows()).find((j) => j.booking_ref === 'SIM-A1')!.agent_price, '900');
  console.log('   OK — price 900');

  step('S6 เส้นทางที่ไม่มีในตาราง → ลงแถวไว้ ราคาว่าง + เตือน → reply ราคา');
  await routeSideJobMessage(msg({ text: `จาก${O1.display_name}: [D]` }), fake);
  const cardD = last();
  assert.match(cardD.text, /ยังไม่มีราคา/);
  assert.equal((await rows()).find((j) => j.booking_ref === 'SIM-D1')!.agent_price, '');
  n = sent.length;
  await routeSideJobMessage(msg({ text: '1,250 บาท', reply_to_message: { message_id: cardD.mid } }), fake);
  console.log('   DEBUG ข้อความที่บอทส่งหลังตอบราคา:', JSON.stringify(since(n).map((x) => `${x.kind}:${x.text.slice(0, 80)}`)));
  assert.equal((await rows()).find((j) => j.booking_ref === 'SIM-D1')!.agent_price, '1250');
  console.log('   OK — ราคาว่างแล้วเติมเป็น 1250');

  step('S7 ปุ่มยกเลิก → status cancelled (การ์ดอัปเดต) → ปุ่มกู้คืน → pending');
  const jobA = (await rows()).find((j) => j.booking_ref === 'SIM-A1')!;
  n = sent.length;
  await handleSideJobCallback({ id: 'c2', data: `sj_cancel:${jobA.job_id}`, message: { chat: { id: 999 }, message_id: cardA.mid } }, fake);
  assert.equal((await rows()).find((j) => j.booking_ref === 'SIM-A1')!.status, 'cancelled');
  assert.ok(since(n).some((x) => x.kind === 'edit' && /ยกเลิกแล้ว/.test(x.text) && x.buttons?.flat().some((b) => b.callback_data.startsWith('sj_restore:'))));
  await handleSideJobCallback({ id: 'c3', data: `sj_restore:${jobA.job_id}`, message: { chat: { id: 999 }, message_id: cardA.mid } }, fake);
  assert.equal((await rows()).find((j) => j.booking_ref === 'SIM-A1')!.status, 'pending');
  console.log('   OK');

  step('S8 รูป 2 ใบส่งพร้อมกัน (media_group) → รวมเป็นชุดเดียว อ่านครั้งเดียว ได้การ์ดเดียว');
  const callsBefore = extractCalls.length;
  n = sent.length;
  await Promise.all([
    routeSideJobMessage(msg({ caption: `จาก${O1.display_name}: [E]`, photo: [{ file_id: 'p1-small', width: 90, height: 90 }, { file_id: 'p1', width: 900, height: 900 }], media_group_id: 'g1' }), fake),
    routeSideJobMessage(msg({ photo: [{ file_id: 'p2', width: 900, height: 900 }], media_group_id: 'g1' }), fake),
  ]);
  assert.equal(extractCalls.length - callsBefore, 1, 'ต้องเรียกอ่านครั้งเดียว');
  assert.equal(extractCalls[extractCalls.length - 1].files, 2, 'ต้องได้ไฟล์ 2 ไฟล์ในชุดเดียว');
  const e1 = (await rows()).find((j) => j.booking_ref === 'SIM-E1')!;
  assert.deepEqual(e1.source_file_ids.split(',').sort(), ['p1', 'p2']);
  assert.equal(since(n).filter((x) => x.kind === 'send' && /บันทึกแล้ว/.test(x.text)).length, 1);
  console.log('   OK — source_file_ids', e1.source_file_ids);

  step('S9 ปุ่ม "เปลี่ยนเจ้าของ" → เลือกเพื่อน C → ชีตเปลี่ยน + การ์ดเดิมถูกแก้');
  n = sent.length;
  await handleSideJobCallback({ id: 'c4', data: `sj_own:${e1.job_id}`, message: { chat: { id: 999 }, message_id: 1 } }, fake);
  const menu = last();
  const tuBtn = menu.buttons!.flat().find((b) => b.text === O3.display_name)!;
  await handleSideJobCallback({ id: 'c5', data: tuBtn.callback_data, message: { chat: { id: 999 }, message_id: menu.mid } }, fake);
  assert.equal((await rows()).find((j) => j.booking_ref === 'SIM-E1')!.owner_id, O3.owner_id);
  assert.ok(since(n).some((x) => x.kind === 'edit' && re(O3).test(x.text)));
  console.log('   OK');

  step('S10 รูปที่ AI อ่านไม่ออก (ไม่มีงาน) → บอกแชมป์ ไม่บันทึกอะไร');
  const total = (await rows()).length;
  await routeSideJobMessage(msg({ text: 'ข้อความทั่วไปที่ไม่มีงานรถอยู่เลย' }), fake);
  assert.match(last().text, /อ่านงาน.*ไม่ได้/);
  assert.equal((await rows()).length, total);
  console.log('   OK');

  // ======================= Batch C =======================
  const NOW = Date.parse('2026-10-11T02:00:00Z'); // 09:00 ไทย วันที่ 11 ต.ค. 2026 (ตรึงเวลาให้ทดสอบซ้ำได้)
  await routeSideJobMessage(msg({ text: `จาก${O1.display_name}: [F]` }), fake);
  await routeSideJobMessage(msg({ text: `จาก${O2.display_name}: [G]` }), fake);
  await routeSideJobMessage(msg({ text: `จาก${O3.display_name}: [H]` }), fake);
  const jobOf = async (ref: string) => (await rows()).find((j) => j.booking_ref === ref)!;

  step('S11 cron เช้า: ถามงานที่ผ่านวันงานแล้วและยังไม่ยืนยัน (งานอนาคตต้องไม่ถูกถาม)');
  n = sent.length;
  const r11 = await sendSideJobConfirmations(NOW);
  const s11 = since(n);
  assert.equal(r11.asked, 3, 'ต้องถาม 3 งาน (F,G,H): ' + JSON.stringify(r11));
  const asks = s11.filter((x) => /ขับจริงไหม/.test(x.text));
  assert.equal(asks.length, 3);
  assert.ok(asks.every((x) => x.buttons?.flat().some((b) => b.callback_data.startsWith('sj_driven:')) && x.buttons?.flat().some((b) => b.callback_data.startsWith('sj_extra:'))));
  assert.ok(!s11.some((x) => /SIM-A1|SIM-B1|SIM-E1/.test(x.text)), 'งานเดือน พ.ย. (อนาคต) ต้องไม่ถูกถาม');
  console.log('   OK — ถาม', r11.asked, 'งาน');
  const askF = asks.find((x) => /SIM-F1/.test(x.text))!, askG = asks.find((x) => /SIM-G1/.test(x.text))!, askH = asks.find((x) => /SIM-H1/.test(x.text))!;

  step('S12 ปุ่ม ขับจริง / ไม่ได้ขับ / เปลี่ยนใจ');
  const fF = await jobOf('SIM-F1'), fG = await jobOf('SIM-G1');
  n = sent.length;
  await handleSideJobCallback({ id: 'd1', data: `sj_driven:${fF.job_id}`, message: { chat: { id: 999 }, message_id: askF.mid } }, fake);
  assert.equal((await jobOf('SIM-F1')).status, 'driven');
  assert.ok(since(n).some((x) => x.kind === 'edit' && x.mid === askF.mid && /ขับจริง/.test(x.text) && x.buttons?.flat().some((b) => b.callback_data.startsWith('sj_undo:'))));
  await handleSideJobCallback({ id: 'd2', data: `sj_notdriven:${fG.job_id}`, message: { chat: { id: 999 }, message_id: askG.mid } }, fake);
  assert.equal((await jobOf('SIM-G1')).status, 'not_driven');
  await handleSideJobCallback({ id: 'd3', data: `sj_undo:${fG.job_id}`, message: { chat: { id: 999 }, message_id: askG.mid } }, fake);
  assert.equal((await jobOf('SIM-G1')).status, 'pending');
  assert.ok(sent.some((x) => x.kind === 'edit' && x.mid === askG.mid && x.buttons?.flat().some((b) => b.callback_data.startsWith('sj_driven:'))), 'เปลี่ยนใจแล้วต้องได้ปุ่มถามกลับมา');
  console.log('   OK');

  step('S13 💰 ค่าใช้จ่ายเพิ่ม: "VTL3036" ต้องไม่ถูกอ่านเป็นเงิน → พิมพ์ "150 ค่าจอด" → ขับจริง + extra');
  const fH = await jobOf('SIM-H1');
  await handleSideJobCallback({ id: 'd4', data: `sj_extra:${fH.job_id}`, message: { chat: { id: 999 }, message_id: askH.mid } }, fake);
  assert.match(last().text, /ค่าใช้จ่ายเพิ่มของงานนี้เท่าไหร่/);
  n = sent.length;
  await routeSideJobMessage(msg({ text: 'VTL3036' }), fake);
  assert.equal((await jobOf('SIM-H1')).status, 'pending', 'VTL3036 ไม่ใช่ค่าใช้จ่าย');
  assert.equal((await jobOf('SIM-H1')).extra_cost, '');
  await routeSideJobMessage(msg({ text: '150 ค่าจอด' }), fake);
  const hh = await jobOf('SIM-H1');
  assert.equal(hh.status, 'driven'); assert.equal(hh.extra_cost, '150'); assert.equal(hh.extra_note, 'ค่าจอด');
  assert.ok(since(n).some((x) => x.kind === 'edit' && x.mid === askH.mid && /150/.test(x.text)), 'ต้องแก้ข้อความถามยืนยันเดิมเป็นผลลัพธ์');
  console.log('   OK — extra', hh.extra_cost, hh.extra_note);
  // หลังจบแล้ว ตัวเลขลอยๆ ต้องไม่ถูกอ่านเป็นค่าใช้จ่ายอีก
  await routeSideJobMessage(msg({ text: '999' }), fake);
  assert.equal((await jobOf('SIM-H1')).extra_cost, '150');

  step('S14 /สรุป: ระบุเพื่อน+เดือน → เฉพาะคนนั้น ยอดถูก; ไม่ระบุ → ทุกคน; งานรอยืนยันเตือนแยก');
  n = sent.length;
  await handleSummaryCommand(`${O1.display_name} ต.ค.`, NOW);
  const t14 = since(n).map((x) => x.text).join('\n');
  assert.match(t14, new RegExp('ตุลาคม 2569 — ' + O1.display_name)); assert.match(t14, /รวม 1 งาน = 600 บาท/);
  assert.ok(!new RegExp(O3.display_name + '|' + O2.display_name).test(t14.replace(/SIM-/g, '')) , 'ต้องไม่มีเพื่อนคนอื่นปน');
  n = sent.length;
  await handleSummaryCommand('', NOW);
  const t14b = since(n).map((x) => x.text).join('\n');
  assert.match(t14b, re(O1)); assert.match(t14b, re(O3)); assert.match(t14b, /รวม 1 งาน = 750 บาท/); // เพื่อน C: 600 + 150
  assert.match(t14b, /ยังไม่ได้ยืนยัน 1 งาน/); // เพื่อน B: G ยัง pending
  console.log('   OK');

  step('S15 /สรุป ที่อ่านไม่ออก → บอกตรงๆ ไม่เดา');
  n = sent.length;
  await handleSummaryCommand('คนที่ไม่รู้จัก', NOW);
  assert.match(last().text, /อ่าน.*ไม่ออก/);
  console.log('   OK');

  step('S16 สรุปวันที่ 1: วันอื่นไม่ส่ง / วันที่ 1 ส่งสรุปเดือนก่อนหน้า');
  n = sent.length;
  assert.deepEqual(await sendMonthlySummariesIfFirstDay(Date.parse('2026-11-05T02:00:00Z')), { sent: false });
  assert.equal(sent.length, n);
  const r16 = await sendMonthlySummariesIfFirstDay(Date.parse('2026-11-01T02:00:00Z'));
  assert.deepEqual(r16, { sent: true, month: '2026-10' });
  const t16 = since(n).map((x) => x.text).join('\n');
  assert.match(t16, /สรุปงานที่ขับให้เพื่อน เดือนตุลาคม 2569/); assert.match(t16, re(O1));
  console.log('   OK');

  step('S17 ถามยืนยันรอบถัดไป: ถามเฉพาะที่ยังค้าง (G) ไม่ถามงานที่ตอบแล้ว');
  n = sent.length;
  const r17 = await sendSideJobConfirmations(NOW);
  assert.equal(r17.asked, 1);
  assert.ok(since(n).some((x) => /SIM-G1/.test(x.text)));
  console.log('   OK');

  console.log('\nSIM ALL OK');
} finally {
  // เก็บกวาด: ยกเลิกแถวทดสอบทั้งหมด (soft delete) — แถว SIM-* ยังอยู่ในชีต ต้องลบเอง
  for (const j of await rows()) if (j.status !== 'cancelled') await cancelSideJob(j.job_id);
  server.close();
}
