// lib/sidejob-intake.ts — รับงานที่เพื่อนส่งมาให้แชมป์ขับ ผ่าน Telegram (ข้อความ / รูปแคปหน้าจอ / PDF)
//
// ไหลของงาน: ข้อความ/ไฟล์จากแชมป์ → (รวมรูปที่ส่งพร้อมกัน) → Gemini อ่านเป็นรายการงาน → จับเจ้าของงาน
//   → บันทึกลงชีต Side_Jobs ทันที → ตอบการ์ดสรุปต่อ 1 งาน พร้อมปุ่ม "เปลี่ยนเจ้าของ / ยกเลิก"
//   แก้ไข = reply ที่การ์ดด้วยข้อความธรรมชาติ ("ราคา 900", "วันที่ 15/10", "pax 4")
// ข้อมูลไม่ครบ (ไม่มีวัน/ต้นทาง/ปลายทาง) = ไม่บันทึกงานนั้น แล้วถามกลับ (ไม่เดา); เจ้าของงานไม่ชัด = ถามด้วยปุ่ม
// ห้าม log เนื้อหาข้อความ/ไฟล์ (PII) — log เฉพาะ metadata

import { getRedis } from './history';
import {
  sendTelegramMessage,
  editTelegramMessage,
  sendTypingAction,
  downloadTelegramFile,
  answerCallbackQuery,
  type TelegramMessage,
  type TelegramCallbackQuery,
  type InlineButton,
} from './telegram';
import { extractSideJobs, extractJobEdit, type ExtractedJob, type InputFile } from './sidejob-extract';
import {
  listOwners,
  resolveOwner,
  listSideJobs,
  addSideJob,
  getSideJob,
  patchSideJob,
  cancelSideJob,
  confirmSideJob,
  confirmationText,
  confirmedText,
  parseExtra,
  lookupAgentPrice,
  dateWarnings,
  jobCardText,
  bangkokToday,
  escapeHtml,
  type Owner,
  type SideJob,
} from './sidejobs';
import { confirmButtons } from './sidejob-daily';
import { log } from './log';

export type Extractor = typeof extractSideJobs;

const TTL_PENDING = 2 * 24 * 3600;
const TTL_CARD = 90 * 24 * 3600;
const TTL_AWAIT = 6 * 3600; // รอตัวเลขค่าใช้จ่ายเพิ่มหลังกด 💰 — สั้นไว้ กันตัวเลขอื่นๆ ที่พิมพ์ทีหลังถูกอ่านผิดเป็นค่าใช้จ่าย
const MAX_JOBS_PER_MESSAGE = 10;
const MAX_LEGS_TO_PICK = 12;
const MAX_FILES = 6;
const MEDIA_GROUP_WAIT_MS = 5000;

interface IncomingFile {
  file_id: string;
  mime?: string;
}
interface Pending {
  text: string;
  files: IncomingFile[];
  forcedOwnerId?: string;
  jobs?: ExtractedJob[]; // งานที่อ่าน/เลือกไว้แล้ว (ถ้ามี = ไม่ต้องให้ AI อ่านซ้ำตอนกลับมาทำต่อ)
}

/** ใบจองหลายเที่ยวที่แชมป์ไม่ได้ระบุว่าขับข้อไหน — รอแชมป์ติ๊กเลือกก่อนบันทึก */
interface LegPick {
  jobs: ExtractedJob[];
  selected: number[];
  priced: boolean[]; // เส้นทางนี้มีราคาในตารางไหม (บอกใบ้ว่าเป็นงานของ CTT)
  text: string;
  files: IncomingFile[];
  prefixOwnerId?: string;
  forcedOwnerId?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- Redis (ล้มเหลวต้องไม่ทำให้การบันทึกงานล้ม ยกเว้นตอนต้องมี state จริง)

async function redisSet(key: string, value: unknown, ttl: number): Promise<boolean> {
  try {
    await getRedis().set(key, value as never, { ex: ttl });
    return true;
  } catch (err) {
    log.error('sidejob.redis_set_failed', { err: (err as Error).message });
    return false;
  }
}
async function redisGet<T>(key: string): Promise<T | null> {
  try {
    return (await getRedis().get<T>(key)) ?? null;
  } catch (err) {
    log.error('sidejob.redis_get_failed', { err: (err as Error).message });
    return null;
  }
}

function newToken(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ---------------------------------------------------------------- ปุ่ม/การ์ด

function cardButtons(job: SideJob): InlineButton[][] {
  if (job.status === 'cancelled') return [[{ text: '↩️ กู้คืน', callback_data: `sj_restore:${job.job_id}` }]];
  return [
    [
      { text: '👤 เปลี่ยนเจ้าของ', callback_data: `sj_own:${job.job_id}` },
      { text: '🗑 ยกเลิก', callback_data: `sj_cancel:${job.job_id}` },
    ],
  ];
}

function ownerName(owners: Owner[], id: string): string {
  return owners.find((o) => o.owner_id === id)?.display_name ?? id;
}

async function sendCard(job: SideJob, owners: Owner[], priceNote?: string): Promise<void> {
  const text = jobCardText(job, ownerName(owners, job.owner_id), priceNote, dateWarnings(job.job_date));
  const mid = await sendTelegramMessage(text, cardButtons(job));
  if (mid) {
    await redisSet(`sj:card:${mid}`, job.job_id, TTL_CARD);
    await patchSideJob(job.job_id, { telegram_card_msg_id: String(mid) });
  }
}

// ---------------------------------------------------------------- แยกชื่อเพื่อนที่พิมพ์นำหน้า

/** "จากชื่อเพื่อน: ..." / "จากชื่อเพื่อน ..." / "ชื่อเพื่อน: ..." — ตัดออกเฉพาะเมื่อชื่อที่จับได้ตรงกับเพื่อนในแท็บ Owners (กัน "จากสนามบิน..." ถูกตัดผิด) */
export function splitOwnerPrefix(text: string, owners: Owner[]): { owner: Owner | null; rest: string } {
  const patterns = [/^\s*(?:จาก|from)\s*([^\s:：,\n]{1,24})/i, /^\s*([^\s:：,\n]{1,24})\s*[:：]/];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const owner = resolveOwner(m[1], owners);
    if (owner) return { owner, rest: text.slice(m[0].length).replace(/^[\s:：,\-–]+/, '') };
  }
  return { owner: null, rest: text };
}

function filesFromMessage(msg: TelegramMessage): IncomingFile[] {
  if (msg.photo?.length) return [{ file_id: msg.photo[msg.photo.length - 1].file_id, mime: 'image/jpeg' }];
  const d = msg.document;
  if (d && (d.mime_type === 'application/pdf' || d.mime_type?.startsWith('image/'))) return [{ file_id: d.file_id, mime: d.mime_type }];
  return [];
}

// ---------------------------------------------------------------- รับงานหลัก

export async function handleIntake(
  input: { text: string; files: IncomingFile[]; forcedOwnerId?: string; isRetry?: boolean },
  extract: Extractor = extractSideJobs
): Promise<void> {
  const today = bangkokToday();

  let owners: Owner[];
  try {
    owners = await listOwners();
  } catch (err) {
    await sendTelegramMessage('❌ อ่านรายชื่อเพื่อนจากชีตไม่ได้ (Apps Script ไม่ตอบ) — ยังไม่ได้บันทึกอะไร ลองส่งใหม่อีกครั้งครับ');
    return;
  }
  if (owners.length === 0) {
    await sendTelegramMessage('แท็บ <code>Owners</code> ในชีต Side Jobs ยังว่าง — ใส่ชื่อเพื่อนก่อนนะครับ');
    return;
  }

  const prefix = splitOwnerPrefix(input.text, owners);
  const text = prefix.rest;

  const files: InputFile[] = [];
  for (const f of input.files.slice(0, MAX_FILES)) {
    const d = await downloadTelegramFile(f.file_id, f.mime);
    if (d) files.push(d);
  }
  if (input.files.length > 0 && files.length === 0 && !text.trim()) {
    await sendTelegramMessage('❌ โหลดไฟล์จาก Telegram ไม่ได้ (ไฟล์ใหญ่เกิน 15MB หรือระบบขัดข้อง) — ลองส่งใหม่ครับ');
    return;
  }

  let jobs: ExtractedJob[];
  let selectionStated = true;
  try {
    const r = await extract({ text, files, ownerNames: owners.map((o) => o.display_name), today });
    jobs = r.jobs;
    selectionStated = r.selectionStated;
  } catch (err) {
    log.error('sidejob_intake.extract_failed', { err: (err as Error).message });
    await sendTelegramMessage('❌ ให้ AI อ่านงานไม่สำเร็จ (ระบบ AI ขัดข้องชั่วคราว) — ยังไม่ได้บันทึกอะไร ลองส่งใหม่อีกครั้งครับ');
    return;
  }

  if (jobs.length === 0) {
    if (!input.isRetry) {
      await sendTelegramMessage('อ่านงานจากข้อความ/ไฟล์นี้ไม่ได้ครับ (ภาพอาจไม่ชัด หรือไม่มีรายละเอียดงานรถ) — ลองส่งภาพที่ชัดขึ้น หรือพิมพ์ วันที่/เส้นทาง/จำนวนคน มาเพิ่ม');
    }
    return;
  }

  const ctx: ProcessCtx = { owners, prefixOwner: prefix.owner, forcedOwnerId: input.forcedOwnerId, text: input.text, files: input.files, isRetry: !!input.isRetry };

  // ใบจองหลายเที่ยวแต่แชมป์ไม่ได้ระบุข้อ → ไม่บันทึกเอง ถามก่อน (ใบจองมักมีเที่ยวของทีมอื่น/จังหวัดอื่นปนอยู่)
  if (jobs.length > 1 && !selectionStated) {
    await askWhichLegs(jobs, ctx);
    return;
  }
  await processJobs(jobs, ctx);
}

interface ProcessCtx {
  owners: Owner[];
  prefixOwner: Owner | null;
  forcedOwnerId?: string;
  text: string; // ข้อความต้นฉบับของแชมป์ (เก็บเป็นหลักฐาน/ใช้ถามกลับ)
  files: IncomingFile[];
  isRetry: boolean;
}

/** งานที่เลือกแล้ว → แยก พร้อมบันทึก / ไม่รู้เจ้าของ / ข้อมูลไม่ครบ แล้วทำตามนั้น */
async function processJobs(jobs: ExtractedJob[], ctx: ProcessCtx): Promise<void> {
  const owners = ctx.owners;
  const forced = ctx.forcedOwnerId ? owners.find((o) => o.owner_id === ctx.forcedOwnerId) ?? null : null;
  const ready: Array<{ job: ExtractedJob; owner: Owner }> = [];
  const needOwner: ExtractedJob[] = [];
  const incomplete: Array<{ job: ExtractedJob; missing: string[] }> = [];

  for (const j of jobs.slice(0, MAX_JOBS_PER_MESSAGE)) {
    const missing: string[] = [];
    if (!j.date) missing.push('วันที่');
    if (!j.origin) missing.push('ต้นทาง');
    if (!j.destination) missing.push('ปลายทาง');
    if (missing.length > 0) {
      incomplete.push({ job: j, missing });
      continue;
    }
    // ลำดับความสำคัญ: ชื่อที่แชมป์พิมพ์นำหน้า > ชื่อที่อ่านเจอในงานนั้น > เจ้าของที่แชมป์กดเลือก
    const owner = ctx.prefixOwner ?? resolveOwner(j.owner_hint, owners) ?? forced;
    if (!owner) {
      needOwner.push(j);
      continue;
    }
    ready.push({ job: j, owner });
  }
  if (jobs.length > MAX_JOBS_PER_MESSAGE) {
    await sendTelegramMessage(`⚠️ เจอ ${jobs.length} งานในครั้งเดียว บันทึกแค่ ${MAX_JOBS_PER_MESSAGE} งานแรก — ที่เหลือส่งมาอีกครั้งครับ`);
  }

  // ---- บันทึกงานที่พร้อม
  if (ready.length > 0) {
    let existing: SideJob[];
    try {
      existing = await listSideJobs();
    } catch {
      await sendTelegramMessage('❌ อ่านชีตไม่ได้ (Apps Script ไม่ตอบ) — ยังไม่ได้บันทึกอะไร ลองส่งใหม่อีกครั้งครับ ระบบกันซ้ำให้');
      return;
    }
    const fileIds = ctx.files.map((f) => f.file_id);
    for (const { job, owner } of ready) {
      const r = await addSideJob(
        {
          owner_id: owner.owner_id,
          job_date: job.date!,
          pickup_time: job.time ?? '',
          booking_ref: job.booking_ref,
          guest_name: job.guest_name,
          pax: job.pax ?? undefined,
          origin: job.origin,
          destination: job.destination,
          source_file_ids: fileIds,
          raw_text: (ctx.text || '').slice(0, 1000),
        },
        existing
      );
      if (r.ok) {
        await sendCard(r.job, owners, r.priceNote);
      } else if (r.reason === 'duplicate') {
        if (!ctx.isRetry) {
          await sendTelegramMessage(
            `⚠️ <b>งานนี้บันทึกไว้แล้ว ไม่ได้ลงซ้ำ</b>\n${escapeHtml(ownerName(owners, r.existing.owner_id))} | ${escapeHtml(r.existing.job_date)} | ${escapeHtml(r.existing.booking_ref || r.existing.guest_name || '-')} | ${escapeHtml(r.existing.origin)} → ${escapeHtml(r.existing.destination)}\n<code>${escapeHtml(r.existing.job_id)}</code>`
          );
        }
      } else {
        await sendTelegramMessage(
          `❌ <b>บันทึกไม่สำเร็จ</b> (Apps Script ไม่ตอบ): ${escapeHtml(job.booking_ref || job.guest_name || job.origin)} ${escapeHtml(job.date ?? '')}\nส่งใหม่ได้เลยครับ ระบบกันซ้ำให้ ถ้าบันทึกไปแล้วจะเตือนว่าซ้ำ`
        );
      }
    }
  }

  // ---- ไม่รู้เจ้าของงาน → ถามด้วยปุ่ม (เก็บข้อความ+ไฟล์ไว้ ไม่ต้องส่งใหม่)
  if (needOwner.length > 0) {
    const token = newToken();
    const pend: Pending = { text: ctx.text, files: ctx.files, forcedOwnerId: ctx.forcedOwnerId, jobs: needOwner };
    const saved = await redisSet(`sj:pend:${token}`, pend, TTL_PENDING);
    if (!saved) {
      await sendTelegramMessage('❌ ระบบจำสถานะไม่ได้ (Redis ขัดข้อง) — ลองส่งใหม่พร้อมพิมพ์ชื่อเพื่อนนำหน้า เช่น "จากชื่อเพื่อน:" ครับ');
    } else {
      const list = needOwner.map((j) => `• ${escapeHtml(j.booking_ref || j.guest_name || '-')} ${escapeHtml(j.date ?? '')} ${escapeHtml(j.origin)} → ${escapeHtml(j.destination)}`).join('\n');
      await sendTelegramMessage(
        `👤 <b>งานนี้ของใครครับ?</b> (${needOwner.length} งาน ยังไม่ได้บันทึก)\n${list}`,
        owners.map((o) => [{ text: o.display_name, callback_data: `sj_pick:${token}:${o.owner_id}` }])
      );
    }
  }

  // ---- ข้อมูลไม่ครบ → ไม่บันทึกงานนั้น ถามกลับ (reply เพื่อเติมข้อมูล)
  if (incomplete.length > 0) {
    const list = incomplete
      .map(({ job, missing }) => `• ${escapeHtml(job.booking_ref || job.guest_name || `${job.origin} → ${job.destination}`)} — ขาด: ${missing.join(', ')}`)
      .join('\n');
    const mid = await sendTelegramMessage(`❓ <b>ข้อมูลไม่ครบ ยังไม่ได้บันทึก ${incomplete.length} งาน</b>\n${list}\n\nreply ข้อความนี้พร้อมข้อมูลที่ขาด (เช่น "วันที่ 20/11") ได้เลยครับ`);
    if (mid) {
      const pend: Pending = { text: ctx.text, files: ctx.files, forcedOwnerId: ctx.prefixOwner?.owner_id ?? ctx.forcedOwnerId };
      await redisSet(`sj:ask:${mid}`, pend, TTL_PENDING);
    }
  }
}

// ---------------------------------------------------------------- ใบจองหลายเที่ยว: ให้แชมป์ติ๊กเลือกว่าขับข้อไหน

const dayMonth = (d: string | null): string => (d ? `${Number(d.slice(8))}/${Number(d.slice(5, 7))}` : '?/?');

function renderLegs(token: string, pick: LegPick): { text: string; buttons: InlineButton[][] } {
  const shown = pick.jobs.slice(0, MAX_LEGS_TO_PICK);
  const lines = shown.map((j, i) => {
    const mark = pick.selected.includes(i) ? '☑️' : '☐';
    return `${mark} <b>${i + 1})</b> ${dayMonth(j.date)}${j.time ? ` ${escapeHtml(j.time)}` : ''} ${pick.priced[i] ? '💰 ' : ''}${escapeHtml(j.origin || '?')} → ${escapeHtml(j.destination || '?')}`;
  });
  const text = [
    `🧩 <b>ใบจองนี้มี ${pick.jobs.length} ข้อ — แชมป์ขับข้อไหนครับ?</b> (ยังไม่ได้บันทึก)`,
    'กดเลือกได้หลายข้อ แล้วกด ✅ บันทึก (💰 = เส้นทางที่มีราคาในตารางของ CTT)',
    '',
    ...lines,
    ...(pick.jobs.length > shown.length ? [`…และอีก ${pick.jobs.length - shown.length} ข้อที่ไม่ได้แสดง`] : []),
  ].join('\n');

  const toggles: InlineButton[] = shown.map((_, i) => ({
    text: `${pick.selected.includes(i) ? '☑️' : '☐'} ${i + 1}`,
    callback_data: `sj_legtog:${token}:${i}`,
  }));
  const rows: InlineButton[][] = [];
  for (let i = 0; i < toggles.length; i += 4) rows.push(toggles.slice(i, i + 4));
  rows.push([
    { text: `✅ บันทึกที่เลือก (${pick.selected.length})`, callback_data: `sj_legok:${token}` },
    { text: 'ทุกข้อ', callback_data: `sj_legall:${token}` },
  ]);
  return { text, buttons: rows };
}

async function askWhichLegs(jobs: ExtractedJob[], ctx: ProcessCtx): Promise<void> {
  const priced = await Promise.all(
    jobs.map(async (j) => {
      if (!j.origin || !j.destination) return false;
      try {
        return (await lookupAgentPrice(j.origin, j.destination, j.pax ?? 2)).price !== '';
      } catch {
        return false;
      }
    })
  );
  const token = newToken();
  const pick: LegPick = {
    jobs: jobs.slice(0, MAX_LEGS_TO_PICK),
    selected: [],
    priced,
    text: ctx.text,
    files: ctx.files,
    prefixOwnerId: ctx.prefixOwner?.owner_id,
    forcedOwnerId: ctx.forcedOwnerId,
  };
  if (!(await redisSet(`sj:legs:${token}`, pick, TTL_PENDING))) {
    await sendTelegramMessage('❌ ระบบจำสถานะไม่ได้ (Redis ขัดข้อง) — ลองส่งใหม่พร้อมบอกข้อที่ขับ เช่น "ข้อ 2" ครับ');
    return;
  }
  const { text, buttons } = renderLegs(token, pick);
  const mid = await sendTelegramMessage(`${text}\n\nหรือ reply ข้อความนี้ว่า "ข้อ 2" / "ทุกข้อ" ก็ได้ครับ`, buttons);
  // reply แทนการกดปุ่ม → อ่านใหม่พร้อมข้อความที่เติม (ใช้กลไกเดียวกับ "ข้อมูลไม่ครบ")
  if (mid) await redisSet(`sj:ask:${mid}`, { text: ctx.text, files: ctx.files, forcedOwnerId: ctx.prefixOwner?.owner_id ?? ctx.forcedOwnerId } satisfies Pending, TTL_PENDING);
}

async function proceedWithLegs(token: string, pick: LegPick, indexes: number[], cqMid: number | undefined): Promise<void> {
  let owners: Owner[];
  try {
    owners = await listOwners();
  } catch {
    await sendTelegramMessage('❌ อ่านรายชื่อเพื่อนจากชีตไม่ได้ (Apps Script ไม่ตอบ) — ยังไม่ได้บันทึกอะไร กดปุ่มอีกครั้งได้ครับ');
    await redisSet(`sj:legs:${token}`, pick, TTL_PENDING); // คืนสถานะให้กดซ้ำได้
    return;
  }
  const chosen = indexes.sort((a, b) => a - b).map((i) => pick.jobs[i]);
  if (cqMid) await editTelegramMessage(cqMid, `⏳ กำลังบันทึก ${chosen.length} ข้อ: ${indexes.map((i) => i + 1).join(', ')}`, []);
  await processJobs(chosen, {
    owners,
    prefixOwner: pick.prefixOwnerId ? owners.find((o) => o.owner_id === pick.prefixOwnerId) ?? null : null,
    forcedOwnerId: pick.forcedOwnerId,
    text: pick.text,
    files: pick.files,
    isRetry: false,
  });
}

// ---------------------------------------------------------------- reply ที่การ์ด = แก้งาน

const PRICE_ONLY = /^\s*([\d,]+(?:\.\d+)?)\s*(?:บาท|฿|baht|thb)?\s*$/i;

export async function handleCardReply(jobId: string, cardMid: number, text: string): Promise<void> {
  const [job, owners] = await Promise.all([getSideJob(jobId), listOwners()]).catch(() => [null, null] as const);
  if (!job || !owners) {
    await sendTelegramMessage('❌ หางานนี้ในชีตไม่เจอ หรืออ่านชีตไม่ได้ (Apps Script ไม่ตอบ) ลองใหม่อีกครั้งครับ');
    return;
  }

  const patch: Partial<Omit<SideJob, 'job_id'>> = {};
  const changes: string[] = [];
  let explicitPrice = false;
  let priceNote: string | undefined;

  const priceOnly = text.match(PRICE_ONLY);
  if (priceOnly) {
    patch.agent_price = String(Number(priceOnly[1].replace(/,/g, '')));
    changes.push(`ราคา ${job.agent_price || '(ว่าง)'} → ${patch.agent_price}`);
    explicitPrice = true;
  } else {
    let e;
    try {
      e = await extractJobEdit({
        text,
        current: { job_date: job.job_date, pickup_time: job.pickup_time, origin: job.origin, destination: job.destination, pax: job.pax },
        ownerNames: owners.map((o) => o.display_name),
      });
    } catch (err) {
      log.error('sidejob_edit.extract_failed', { err: (err as Error).message });
      await sendTelegramMessage('❌ ให้ AI อ่านคำสั่งแก้ไม่สำเร็จ (ระบบ AI ขัดข้องชั่วคราว) ลองใหม่อีกครั้งครับ');
      return;
    }
    if (e.owner_hint) {
      const o = resolveOwner(e.owner_hint, owners);
      if (!o) {
        await sendTelegramMessage(`❌ ไม่รู้จักเพื่อนชื่อ "${escapeHtml(e.owner_hint)}" — ใช้ปุ่ม 👤 เปลี่ยนเจ้าของ ที่การ์ดแทนครับ`);
        return;
      }
      patch.owner_id = o.owner_id;
      changes.push(`เจ้าของ → ${o.display_name}`);
    }
    const set = (k: Exclude<keyof SideJob, 'job_id' | 'status'>, v: string | null, label: string) => {
      if (v !== null && v !== job[k]) {
        (patch as Record<string, string>)[k] = v;
        changes.push(`${label} ${job[k] || '(ว่าง)'} → ${v}`);
      }
    };
    set('job_date', e.job_date, 'วันที่');
    set('pickup_time', e.pickup_time, 'เวลา');
    set('booking_ref', e.booking_ref, 'booking');
    set('guest_name', e.guest_name, 'แขก');
    set('origin', e.origin, 'ต้นทาง');
    set('destination', e.destination, 'ปลายทาง');
    set('pax', e.pax !== null ? String(e.pax) : null, 'จำนวนคน');
    set('extra_cost', e.extra_cost !== null ? String(e.extra_cost) : null, 'ค่าใช้จ่ายเพิ่ม');
    set('extra_note', e.extra_note, 'โน้ตค่าใช้จ่าย');
    if (e.agent_price !== null) {
      set('agent_price', String(e.agent_price), 'ราคา');
      explicitPrice = true;
    }
  }

  if (changes.length === 0) {
    await sendTelegramMessage('ไม่เข้าใจว่าจะแก้อะไรครับ — ตัวอย่าง: "ราคา 900", "วันที่ 15/10", "pax 4", "เวลา 14:30" (reply ที่การ์ดงานนั้น)');
    return;
  }

  // เส้นทาง/จำนวนคนเปลี่ยน และแชมป์ไม่ได้ระบุราคาเอง → คิดราคา Agent ใหม่จากตาราง (ไม่เจอ = ว่าง + ถามแชมป์)
  const routeChanged = patch.origin !== undefined || patch.destination !== undefined || patch.pax !== undefined;
  if (routeChanged && !explicitPrice) {
    const next = { ...job, ...patch };
    const r = await lookupAgentPrice(next.origin, next.destination, Number(next.pax) || undefined);
    patch.agent_price = r.price;
    priceNote = r.note;
    changes.push(`ราคา ${job.agent_price || '(ว่าง)'} → ${r.price || '(ว่าง — ยังไม่มีราคา)'}`);
  }

  const res = await patchSideJob(jobId, patch);
  if (!res.ok) {
    await sendTelegramMessage('❌ แก้ในชีตไม่สำเร็จ (Apps Script ไม่ตอบ) ยังไม่ได้เปลี่ยนอะไร ลองใหม่อีกครั้งครับ');
    return;
  }
  const updated: SideJob = { ...job, ...patch } as SideJob;
  const card = jobCardText(updated, ownerName(owners, updated.owner_id), priceNote, dateWarnings(updated.job_date));
  await editTelegramMessage(cardMid, card, cardButtons(updated));
  await sendTelegramMessage(`✏️ <b>แก้แล้ว</b>\n${changes.map((c) => `• ${escapeHtml(c)}`).join('\n')}`);
}

// ---------------------------------------------------------------- ยืนยันหลังวันงาน: ขับจริงไหม / ค่าใช้จ่ายเพิ่ม

interface AwaitExtra {
  job_id: string;
  confirm_mid?: number; // ข้อความถามยืนยันของงานนี้ (จะถูกแก้เป็นผลลัพธ์)
}

async function renderConfirmed(jobId: string, mid: number | undefined): Promise<void> {
  const [job, owners] = await Promise.all([getSideJob(jobId), listOwners()]);
  if (!job || !mid) return;
  const name = ownerName(owners, job.owner_id);
  await editTelegramMessage(mid, confirmedText(job, name), [[{ text: '↩️ เปลี่ยนใจ', callback_data: `sj_undo:${jobId}` }]]);
}

export async function handleExtraText(a: AwaitExtra, text: string): Promise<void> {
  const parsed = parseExtra(text);
  if (!parsed) {
    await sendTelegramMessage('ใส่ตัวเลขค่าใช้จ่ายตัวเดียวครับ เช่น "150" หรือ "150 ค่าจอด" (ถ้ามีหลายรายการ ให้รวมเป็นยอดเดียว)');
    return;
  }
  const r = await confirmSideJob(a.job_id, 'driven', { extra_cost: parsed.cost, extra_note: parsed.note });
  if (!r.ok) {
    await sendTelegramMessage('❌ บันทึกค่าใช้จ่ายไม่สำเร็จ (Apps Script ไม่ตอบ) ลองพิมพ์ตัวเลขใหม่อีกครั้งครับ');
    return;
  }
  try {
    await getRedis().del('sj:await');
  } catch {
    /* หมดอายุเองใน 6 ชม. */
  }
  await renderConfirmed(a.job_id, a.confirm_mid);
  await sendTelegramMessage(`✅ บันทึกแล้ว: ขับจริง + ค่าใช้จ่ายเพิ่ม ${parsed.cost.toLocaleString('en-US')} บาท${parsed.note ? ` (${escapeHtml(parsed.note)})` : ''}`);
}

// ---------------------------------------------------------------- ปุ่มกด (callback prefix sj_)

/** คืน true ถ้าเป็นปุ่มของระบบนี้ (ไม่ว่าสำเร็จหรือไม่) */
export async function handleSideJobCallback(cq: TelegramCallbackQuery, extract: Extractor = extractSideJobs): Promise<boolean> {
  const [action, a, b] = cq.data.split(':');
  if (!action.startsWith('sj_')) return false;
  const mid = cq.message?.message_id;

  try {
    if (action === 'sj_cancel' || action === 'sj_restore') {
      const r = action === 'sj_cancel' ? await cancelSideJob(a) : await patchSideJob(a, { status: 'pending' });
      if (!r.ok) {
        await answerCallbackQuery(cq.id, 'ไม่สำเร็จ (Apps Script ไม่ตอบ) ลองใหม่ครับ');
        return true;
      }
      await answerCallbackQuery(cq.id, action === 'sj_cancel' ? 'ยกเลิกแล้ว (กู้คืนได้)' : 'กู้คืนแล้ว');
      const [job, owners] = await Promise.all([getSideJob(a), listOwners()]);
      if (job && mid) await editTelegramMessage(mid, jobCardText(job, ownerName(owners, job.owner_id), undefined, dateWarnings(job.job_date)), cardButtons(job));
      return true;
    }

    if (action === 'sj_own') {
      await answerCallbackQuery(cq.id);
      const owners = await listOwners();
      await sendTelegramMessage(
        `เปลี่ยนเจ้าของงาน <code>${escapeHtml(a)}</code> เป็นใครครับ?`,
        owners.map((o) => [{ text: o.display_name, callback_data: `sj_setown:${a}:${o.owner_id}` }])
      );
      return true;
    }

    if (action === 'sj_setown') {
      const r = await patchSideJob(a, { owner_id: b });
      if (!r.ok) {
        await answerCallbackQuery(cq.id, 'ไม่สำเร็จ (Apps Script ไม่ตอบ) ลองใหม่ครับ');
        return true;
      }
      await answerCallbackQuery(cq.id, 'เปลี่ยนเจ้าของแล้ว ✅');
      const [job, owners] = await Promise.all([getSideJob(a), listOwners()]);
      if (job) {
        const cardMid = Number(job.telegram_card_msg_id);
        if (cardMid) await editTelegramMessage(cardMid, jobCardText(job, ownerName(owners, job.owner_id), undefined, dateWarnings(job.job_date)), cardButtons(job));
        if (mid) await editTelegramMessage(mid, `✅ เปลี่ยนเจ้าของงาน <code>${escapeHtml(a)}</code> เป็น ${escapeHtml(ownerName(owners, b))} แล้ว`, []);
      }
      return true;
    }

    if (action === 'sj_driven' || action === 'sj_notdriven') {
      const r = await confirmSideJob(a, action === 'sj_driven' ? 'driven' : 'not_driven');
      if (!r.ok) {
        await answerCallbackQuery(cq.id, 'ไม่สำเร็จ (Apps Script ไม่ตอบ) ลองใหม่ครับ');
        return true;
      }
      await answerCallbackQuery(cq.id, action === 'sj_driven' ? 'ขับจริง ✅' : 'ไม่ได้ขับ');
      await renderConfirmed(a, mid);
      return true;
    }

    if (action === 'sj_undo') {
      const r = await patchSideJob(a, { status: 'pending', confirmed_at: '', extra_cost: '', extra_note: '' });
      if (!r.ok) {
        await answerCallbackQuery(cq.id, 'ไม่สำเร็จ (Apps Script ไม่ตอบ) ลองใหม่ครับ');
        return true;
      }
      await answerCallbackQuery(cq.id, 'กลับเป็นรอยืนยันแล้ว');
      const [job, owners] = await Promise.all([getSideJob(a), listOwners()]);
      if (job && mid) await editTelegramMessage(mid, confirmationText(job, ownerName(owners, job.owner_id)), confirmButtons(a));
      return true;
    }

    if (action === 'sj_extra') {
      await answerCallbackQuery(cq.id);
      const aw: AwaitExtra = { job_id: a, confirm_mid: mid };
      await redisSet('sj:await', aw, TTL_AWAIT);
      const askMid = await sendTelegramMessage('💰 <b>ค่าใช้จ่ายเพิ่มของงานนี้เท่าไหร่ครับ?</b>\nพิมพ์ตัวเลขได้เลย (ใส่โน้ตต่อท้ายได้ เช่น "150 ค่าจอด") — พิมพ์แล้วจะนับเป็น "ขับจริง" ให้ด้วย');
      if (askMid) await redisSet(`sj:xask:${askMid}`, aw, TTL_AWAIT);
      return true;
    }

    if (action === 'sj_legtog' || action === 'sj_legok' || action === 'sj_legall') {
      const key = `sj:legs:${a}`;
      const pick = await redisGet<LegPick>(key);
      if (!pick) {
        await answerCallbackQuery(cq.id, 'หมดอายุหรือบันทึกไปแล้ว — ส่งใบจองใหม่ได้ครับ');
        return true;
      }
      if (action === 'sj_legtog') {
        const i = Number(b);
        pick.selected = pick.selected.includes(i) ? pick.selected.filter((x) => x !== i) : [...pick.selected, i];
        await redisSet(key, pick, TTL_PENDING);
        await answerCallbackQuery(cq.id);
        const { text, buttons } = renderLegs(a, pick);
        if (mid) await editTelegramMessage(mid, `${text}\n\nหรือ reply ข้อความนี้ว่า "ข้อ 2" / "ทุกข้อ" ก็ได้ครับ`, buttons);
        return true;
      }
      const indexes = action === 'sj_legall' ? pick.jobs.map((_, i) => i) : pick.selected;
      if (indexes.length === 0) {
        await answerCallbackQuery(cq.id, 'ยังไม่ได้เลือกข้อ — กดเลขข้อก่อนครับ');
        return true;
      }
      // กันกดซ้ำ: ลบสถานะก่อนเริ่มบันทึก (ถ้าอ่านรายชื่อเพื่อนไม่ได้จะคืนสถานะให้)
      try {
        await getRedis().del(key);
      } catch {
        /* หมดอายุเอง */
      }
      await answerCallbackQuery(cq.id, 'กำลังบันทึก...');
      await proceedWithLegs(a, pick, [...indexes], mid);
      return true;
    }

    if (action === 'sj_pick') {
      const pend = await redisGet<Pending>(`sj:pend:${a}`);
      if (!pend) {
        await answerCallbackQuery(cq.id, 'หมดอายุแล้ว — ส่งงานใหม่อีกครั้งครับ');
        return true;
      }
      await answerCallbackQuery(cq.id, 'กำลังบันทึก...');
      if (mid) await editTelegramMessage(mid, '⏳ กำลังบันทึก...', []);
      if (pend.jobs?.length) {
        // งานอ่านไว้แล้ว (ผ่านขั้นเลือกข้อมาแล้ว) → บันทึกต่อได้เลย ไม่ให้ AI อ่านซ้ำ ไม่ถามเลือกข้อซ้ำ
        const owners = await listOwners();
        await processJobs(pend.jobs, { owners, prefixOwner: null, forcedOwnerId: b, text: pend.text, files: pend.files, isRetry: true });
      } else {
        await handleIntake({ text: pend.text, files: pend.files, forcedOwnerId: b, isRetry: true }, extract);
      }
      return true;
    }
  } catch (err) {
    log.error('sidejob_callback.error', { action, err: (err as Error).message });
    await answerCallbackQuery(cq.id, 'เกิดข้อผิดพลาด ลองใหม่ครับ');
    return true;
  }

  await answerCallbackQuery(cq.id);
  return true;
}

// ---------------------------------------------------------------- ทางเข้าจาก webhook

/** ไม่ใช่คำสั่ง (/...) และมาจากแชมป์เท่านั้น (webhook เช็คแล้ว) */
export async function routeSideJobMessage(msg: TelegramMessage, extract: Extractor = extractSideJobs): Promise<void> {
  try {
    await sendTypingAction();

    // รูปหลายใบที่ส่งพร้อมกัน: Telegram แยกเป็นหลาย update (media_group_id เดียวกัน) → รวมเป็นชุดเดียวก่อนอ่าน
    if (msg.media_group_id) {
      const gid = msg.media_group_id;
      const item = { files: filesFromMessage(msg), text: (msg.caption ?? msg.text ?? '').trim() };
      const r = getRedis();
      await r.rpush(`sj:mg:${gid}`, JSON.stringify(item));
      await r.expire(`sj:mg:${gid}`, 300);
      const leader = await r.set(`sj:mgl:${gid}`, '1', { nx: true, ex: 300 });
      if (!leader) return; // ตัวแรกที่มาถึงเป็นคนรวบรวมและประมวลผล
      await sleep(MEDIA_GROUP_WAIT_MS);
      const raw = await r.lrange(`sj:mg:${gid}`, 0, -1);
      await r.del(`sj:mg:${gid}`);
      const items = raw.map((x) => (typeof x === 'string' ? JSON.parse(x) : x)) as Array<{ files: IncomingFile[]; text: string }>;
      const text = Array.from(new Set(items.map((i) => i.text).filter(Boolean))).join('\n');
      await handleIntake({ text, files: items.flatMap((i) => i.files) }, extract);
      return;
    }

    const text = (msg.text ?? msg.caption ?? '').trim();
    const files = filesFromMessage(msg);
    if (msg.document && files.length === 0) {
      await sendTelegramMessage('รองรับเฉพาะไฟล์ PDF และรูปภาพครับ');
      return;
    }

    // reply ที่การ์ดงาน = แก้งาน / reply ที่คำถามข้อมูลไม่ครบ = เติมข้อมูล
    const replyTo = msg.reply_to_message?.message_id;
    if (replyTo && files.length === 0 && text) {
      const jobId = await redisGet<string>(`sj:card:${replyTo}`);
      if (jobId) {
        await handleCardReply(jobId, replyTo, text);
        return;
      }
      const xa = await redisGet<AwaitExtra>(`sj:xask:${replyTo}`);
      if (xa) {
        await handleExtraText(xa, text);
        return;
      }
      const pend = await redisGet<Pending>(`sj:ask:${replyTo}`);
      if (pend) {
        await handleIntake(
          { text: `${pend.text}\n\n[ข้อมูลที่แชมป์เติมให้]: ${text}`, files: pend.files, forcedOwnerId: pend.forcedOwnerId, isRetry: true },
          extract
        );
        return;
      }
    }

    // หลังกด 💰 บอทรอตัวเลขค่าใช้จ่าย: ข้อความสั้นที่มีตัวเลขตัวเดียว (ไม่ได้ reply ก็ได้) นับเป็นค่าใช้จ่าย
    if (!files.length && text && text.length <= 40 && parseExtra(text)) {
      const aw = await redisGet<AwaitExtra>('sj:await');
      if (aw) {
        await handleExtraText(aw, text);
        return;
      }
    }

    if (!files.length && text.length < 6) {
      await sendTelegramMessage('ส่งงานที่เพื่อนฝากมาได้เลยครับ — ใบจอง PDF, รูปแคปหน้าจอ (ส่งหลายรูปพร้อมกันได้) หรือพิมพ์รายละเอียด โดยขึ้นต้นชื่อเพื่อน เช่น "จากชื่อเพื่อน:"');
      return;
    }
    await handleIntake({ text, files }, extract);
  } catch (err) {
    log.error('sidejob_route.error', { err: (err as Error).message });
    await sendTelegramMessage('❌ เกิดข้อผิดพลาดตอนรับงาน — ยังไม่แน่ใจว่าบันทึกไปหรือยัง ตรวจในชีตก่อน แล้วส่งใหม่ได้ (ระบบกันซ้ำให้)');
  }
}

