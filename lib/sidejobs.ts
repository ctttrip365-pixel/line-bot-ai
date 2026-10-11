// lib/sidejobs.ts — สมุดบัญชีงานที่แชมป์ขับให้เพื่อน ("CTT - Side Jobs" Sheet)
//
// ปัญหาที่แก้: งานที่เพื่อนส่งมาให้ขับไม่มีใครจด ปลายเดือนเคลียร์เงินไม่ครบ
// แท็บ `Side_Jobs` = ทุกงาน, แท็บ `Owners` = เพื่อนที่ส่งงานให้ (+ชื่อเล่น)
// ชีตนี้แยกจากชีตจัดคนขับ — เข้าถึงผ่าน gas-client ด้วย book:'sidejobs' (Script Property SIDEJOB_SHEET_ID)
// ห้ามใส่เลขชีต/รายชื่อเพื่อน/เลขบัญชีในโค้ด (repo เป็น PUBLIC)

import { sheetRead, sheetAppendRow, sheetUpdateRow } from './gas-client';
import { lookupPrice } from './prices';
import { norm } from './text-norm';
import { log } from './log';

const BOOK = 'sidejobs' as const;
const JOBS_TAB = 'Side_Jobs';
const OWNERS_TAB = 'Owners';

export type SideJobStatus = 'pending' | 'driven' | 'not_driven' | 'cancelled';

/** ทุกช่องเป็น string เพราะอ่าน/เขียนผ่าน Apps Script (หัวคอลัมน์ในชีตต้องตรงชื่อ field เหล่านี้เป๊ะ) */
export interface SideJob {
  job_id: string;
  owner_id: string;
  job_date: string; // YYYY-MM-DD
  pickup_time: string; // HH:MM หรือว่าง
  booking_ref: string;
  guest_name: string;
  pax: string;
  origin: string;
  destination: string;
  agent_price: string; // ว่าง = ยังไม่มีราคา ต้องถามแชมป์
  extra_cost: string;
  extra_note: string;
  status: SideJobStatus;
  source_file_ids: string; // Telegram file_id คั่นด้วย , (หลักฐานต้นทาง — ไม่ใช่ URL ที่มี token)
  raw_text: string;
  created_at: string; // ISO
  confirmed_at: string; // ISO
  telegram_card_msg_id: string;
}

export interface Owner {
  owner_id: string;
  display_name: string;
  aliases: string; // คั่นด้วย ,
}

export const SIDE_JOB_COLUMNS: Array<keyof SideJob> = [
  'job_id', 'owner_id', 'job_date', 'pickup_time', 'booking_ref', 'guest_name', 'pax', 'origin', 'destination',
  'agent_price', 'extra_cost', 'extra_note', 'status', 'source_file_ids', 'raw_text', 'created_at', 'confirmed_at',
  'telegram_card_msg_id',
];

// ---------------------------------------------------------------- เวลา/วันที่ (ไทย)

/** วันที่ไทยตอนนี้ YYYY-MM-DD */
export function bangkokToday(now = Date.now()): string {
  return new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/** เดือนก่อนหน้าของวันที่ไทยตอนนี้ YYYY-MM */
export function previousMonth(now = Date.now()): string {
  const [y, m] = bangkokToday(now).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const TH_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** "2026-10" → "ตุลาคม 2569" */
export function monthLabelTh(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${TH_MONTHS[m - 1] ?? month} ${y + 543}`;
}

/** "2026-10-15" → "15 ต.ค." */
function dayLabelTh(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${d} ${TH_MONTHS_SHORT[m - 1] ?? ''}`.trim();
}

// ---------------------------------------------------------------- เพื่อน (Owners)

export async function listOwners(): Promise<Owner[]> {
  const res = await sheetRead<Owner[]>(OWNERS_TAB, BOOK);
  if (!res.ok || !res.data) {
    log.error('sidejobs.owners_read_failed', { error: res.error });
    throw new Error(`อ่านแท็บ Owners ไม่ได้: ${res.error ?? 'unknown'}`);
  }
  return res.data.filter((o) => o.owner_id);
}

/** จับชื่อเพื่อนจาก owner_id / ชื่อ / ชื่อเล่น (เทียบด้วย norm) — ไม่เจอ = null → ให้บอทถามแชมป์ */
export function resolveOwner(hint: string | undefined | null, owners: Owner[]): Owner | null {
  const h = norm(String(hint ?? ''));
  if (!h) return null;
  for (const o of owners) {
    const names = [o.owner_id, o.display_name, ...String(o.aliases ?? '').split(',')].map((n) => norm(n)).filter(Boolean);
    if (names.includes(h)) return o;
  }
  return null;
}

// ---------------------------------------------------------------- งาน (Side_Jobs)

function toJob(row: Record<string, string>): SideJob {
  const job = {} as Record<string, string>;
  for (const c of SIDE_JOB_COLUMNS) job[c] = String(row[c] ?? '');
  return job as unknown as SideJob;
}

/** อ่านไม่ได้ = throw (ห้ามคืน [] เงียบๆ — จะทำให้กันซ้ำพลาด/สรุปยอดว่างโดยแชมป์ไม่รู้) */
export async function listSideJobs(): Promise<SideJob[]> {
  const res = await sheetRead<Record<string, string>[]>(JOBS_TAB, BOOK);
  if (!res.ok || !res.data) {
    log.error('sidejobs.read_failed', { error: res.error });
    throw new Error(`อ่านแท็บ Side_Jobs ไม่ได้: ${res.error ?? 'unknown'}`);
  }
  return res.data.filter((r) => r.job_id).map(toJob);
}

export async function getSideJob(jobId: string): Promise<SideJob | null> {
  return (await listSideJobs()).find((j) => j.job_id === jobId) ?? null;
}

/** key กันซ้ำ: เจ้าของ + booking + วัน + เส้นทาง (booking เดียวมีหลายเที่ยว/หลายวันได้) */
export function dedupeKey(j: Pick<SideJob, 'owner_id' | 'booking_ref' | 'job_date' | 'origin' | 'destination'>): string {
  return [j.owner_id, j.booking_ref, j.job_date, j.origin, j.destination].map((p) => norm(String(p ?? ''))).join('|');
}

export function newJobId(now = Date.now()): string {
  const ymd = bangkokToday(now).replace(/-/g, '').slice(2);
  const rand = Math.random().toString(36).slice(2, 6);
  return `SJ-${ymd}-${rand}`;
}

export interface NewSideJobInput {
  owner_id: string;
  job_date: string;
  pickup_time?: string;
  booking_ref?: string;
  guest_name?: string;
  pax?: number;
  origin: string;
  destination: string;
  source_file_ids?: string[];
  raw_text?: string;
}

/**
 * ราคา Agent ของเที่ยวนี้ (ราคาที่เพื่อนจ่ายแชมป์) — ไม่เจอ/ไม่ชัด/ไม่ทราบ pax = price ว่าง + note บอกเหตุผล (ห้ามเดา)
 * ต้องใช้ lp.agentPrice ไม่ใช่ lp.price (ราคาขายลูกค้า = Agent +15% ปัดร้อย)
 */
export async function lookupAgentPrice(origin: string, destination: string, pax: number | undefined | null): Promise<{ price: string; note?: string }> {
  if (!pax || pax < 1) return { price: '', note: 'ยังไม่ทราบจำนวนคน (pax) จึงยังคิดราคาไม่ได้' };
  const lp = await lookupPrice(origin, destination, pax);
  if (lp.status === 'ok') return { price: String(lp.agentPrice) };
  return { price: '', note: lp.message };
}

/** เตือนวันที่ผิดปกติ (มักเกิดจากอ่านปีผิด) — แสดงในการ์ดให้แชมป์เห็น */
export function dateWarnings(jobDate: string, today = bangkokToday()): string[] {
  const days = Math.round((Date.parse(jobDate) - Date.parse(today)) / 86400000);
  if (!Number.isFinite(days)) return [];
  if (days < -45) return [`วันที่งานผ่านมาแล้ว ${-days} วัน — ตรวจปีให้ถูกต้องไหม`];
  if (days > 240) return [`วันที่งานอีก ${days} วัน (เกิน 8 เดือน) — ตรวจปีให้ถูกต้องไหม`];
  return [];
}

export type AddSideJobResult =
  | { ok: true; job: SideJob; priceNote?: string }
  | { ok: false; reason: 'duplicate'; existing: SideJob }
  | { ok: false; reason: 'write_failed'; error: string };

/**
 * บันทึกงานใหม่: กันซ้ำ → หาราคา Agent → append
 * ราคาไม่เจอ (not_found/ambiguous/handoff) = ลงแถวไว้แต่ agent_price ว่าง + priceNote ให้บอทถามแชมป์ (ห้ามเดาราคา)
 * เขียนชีตไม่สำเร็จ = ok:false ห้ามบอกแชมป์ว่าบันทึกแล้ว และไม่ retry เอง (คำขอแรกอาจสำเร็จไปแล้ว → แถวซ้ำ)
 */
export async function addSideJob(input: NewSideJobInput, preloaded?: SideJob[]): Promise<AddSideJobResult> {
  const candidate = {
    owner_id: input.owner_id,
    booking_ref: input.booking_ref ?? '',
    job_date: input.job_date,
    origin: input.origin,
    destination: input.destination,
  };

  // booking_ref ว่าง = ไม่มีหลักให้เทียบ ใช้ key เดียวกันได้แต่เสี่ยงชนงานต่างแขก → เทียบ guest_name ด้วยเมื่อไม่มี booking
  const existing = preloaded ?? (await listSideJobs());
  const key = dedupeKey(candidate);
  const dup = existing.find(
    (j) =>
      j.status !== 'cancelled' &&
      dedupeKey(j) === key &&
      (candidate.booking_ref !== '' || norm(j.guest_name) === norm(input.guest_name ?? ''))
  );
  if (dup) return { ok: false, reason: 'duplicate', existing: dup };

  const { price: agent_price, note: priceNote } = await lookupAgentPrice(input.origin, input.destination, input.pax);

  const now = new Date().toISOString();
  const job: SideJob = {
    job_id: newJobId(),
    owner_id: input.owner_id,
    job_date: input.job_date,
    pickup_time: input.pickup_time ?? '',
    booking_ref: input.booking_ref ?? '',
    guest_name: input.guest_name ?? '',
    pax: input.pax ? String(input.pax) : '',
    origin: input.origin,
    destination: input.destination,
    agent_price,
    extra_cost: '',
    extra_note: '',
    status: 'pending',
    source_file_ids: (input.source_file_ids ?? []).join(','),
    raw_text: input.raw_text ?? '',
    created_at: now,
    confirmed_at: '',
    telegram_card_msg_id: '',
  };

  const res = await sheetAppendRow(JOBS_TAB, job as unknown as Record<string, string>, BOOK);
  if (!res.ok) {
    log.error('sidejobs.append_failed', { job_id: job.job_id, error: res.error });
    return { ok: false, reason: 'write_failed', error: res.error ?? 'unknown' };
  }
  log.info('sidejobs.added', { job_id: job.job_id, owner_id: job.owner_id, priced: agent_price !== '' });
  preloaded?.push(job);
  return { ok: true, job, priceNote };
}

export async function patchSideJob(jobId: string, patch: Partial<Omit<SideJob, 'job_id'>>): Promise<{ ok: boolean; error?: string }> {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(patch)) clean[k] = String(v ?? '');
  const res = await sheetUpdateRow(JOBS_TAB, 'job_id', jobId, clean, BOOK);
  if (!res.ok) log.error('sidejobs.patch_failed', { job_id: jobId, error: res.error });
  return { ok: res.ok, error: res.error };
}

/** ยืนยันผลหลังวันงาน: ขับจริง / ไม่ได้ขับ (extra_cost/extra_note ใส่ได้เมื่อขับจริง) */
export function confirmSideJob(
  jobId: string,
  status: 'driven' | 'not_driven',
  extra?: { extra_cost?: number; extra_note?: string }
): Promise<{ ok: boolean; error?: string }> {
  return patchSideJob(jobId, {
    status,
    confirmed_at: new Date().toISOString(),
    ...(extra?.extra_cost ? { extra_cost: String(extra.extra_cost) } : {}),
    ...(extra?.extra_note ? { extra_note: extra.extra_note } : {}),
  });
}

/** ยกเลิก = soft delete (status cancelled) ไม่ลบแถวจริง */
export function cancelSideJob(jobId: string): Promise<{ ok: boolean; error?: string }> {
  return patchSideJob(jobId, { status: 'cancelled' });
}

/** งานที่ต้องถาม "ขับจริงไหม" — pending และวันงานผ่านมาแล้ว (ก่อนวันนี้ตามเวลาไทย) เรียงเก่าสุดก่อน */
export function jobsAwaitingConfirmation(jobs: SideJob[], today = bangkokToday()): SideJob[] {
  return jobs
    .filter((j) => j.status === 'pending' && j.job_date && j.job_date < today)
    .sort((a, b) => (a.job_date + a.pickup_time).localeCompare(b.job_date + b.pickup_time));
}

// ---------------------------------------------------------------- ข้อความ Telegram (HTML parse_mode)

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const num = (s: string): number => {
  const n = Number(String(s ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const baht = (n: number): string => n.toLocaleString('en-US');

function routeText(j: SideJob): string {
  return `${j.origin} → ${j.destination}`;
}

/** การ์ดสรุปหลังบันทึก/แก้ไข */
export function jobCardText(j: SideJob, ownerName: string, priceNote?: string, warnings: string[] = []): string {
  const lines = [
    `✅ <b>บันทึกแล้ว</b> — ${escapeHtml(ownerName)}`,
    `📅 ${dayLabelTh(j.job_date)}${j.pickup_time ? ` ${escapeHtml(j.pickup_time)}` : ''}${j.booking_ref ? ` | ${escapeHtml(j.booking_ref)}` : ''}`,
    `🚐 ${escapeHtml(routeText(j))}${j.pax ? ` | ${escapeHtml(j.pax)} คน` : ''}`,
  ];
  if (j.guest_name) lines.push(`👤 ${escapeHtml(j.guest_name)}`);
  if (j.agent_price) {
    lines.push(`💰 ${baht(num(j.agent_price))} บาท`);
  } else {
    lines.push('⚠️ <b>ยังไม่มีราคา</b> — reply ข้อความนี้เป็นตัวเลขราคา (บาท) ได้เลย');
    if (priceNote) lines.push(`<i>${escapeHtml(priceNote)}</i>`);
  }
  for (const w of warnings) lines.push(`⚠️ ${escapeHtml(w)}`);
  if (j.status === 'cancelled') lines.push('🗑 <b>ยกเลิกแล้ว</b>');
  lines.push(`<code>${escapeHtml(j.job_id)}</code> · แก้ไข: reply ข้อความนี้ เช่น "วันที่ 15/10" "pax 4"`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- สรุปปลายเดือน

export const TELEGRAM_CHUNK = 3500; // เผื่อ tag HTML ใต้เพดาน 4,096

/** สรุปยอดของเพื่อน 1 คนในเดือนหนึ่ง → ข้อความพร้อมก๊อป (แบ่งก้อนตามเพดาน Telegram) */
export function buildOwnerSummary(jobs: SideJob[], owner: Owner, month: string): string[] {
  const mine = jobs
    .filter((j) => j.owner_id === owner.owner_id && j.job_date.startsWith(month) && j.status !== 'cancelled' && j.status !== 'not_driven')
    .sort((a, b) => (a.job_date + a.pickup_time).localeCompare(b.job_date + b.pickup_time));

  // ก้อนที่แชมป์ก๊อปส่งเพื่อนมีเฉพาะงานขับจริง + มีราคาแล้ว (ยอดกับจำนวนงานต้องตรงกัน)
  // งานที่ยังไม่มีราคา/ยังไม่ยืนยัน แจ้งเตือนแยกให้แชมป์เห็นเอง ไม่ปนในข้อความที่จะส่งออกไป
  const drivenAll = mine.filter((j) => j.status === 'driven');
  const driven = drivenAll.filter((j) => j.agent_price);
  const unpriced = drivenAll.filter((j) => !j.agent_price);
  const pending = mine.filter((j) => j.status === 'pending');

  const row = (j: SideJob, i: number): string => {
    const extra = num(j.extra_cost);
    return (
      `${i + 1}) ${dayLabelTh(j.job_date)} | ${j.booking_ref || j.guest_name || '-'} | ${routeText(j)} | ${baht(num(j.agent_price))}` +
      (extra ? ` (+${baht(extra)}${j.extra_note ? ` ${j.extra_note}` : ''})` : '')
    );
  };

  const total = driven.reduce((s, j) => s + num(j.agent_price) + num(j.extra_cost), 0);
  const head = `สรุปงานเดือน${monthLabelTh(month)} — ${owner.display_name}`;
  const foot = `รวม ${driven.length} งาน = ${baht(total)} บาท`;

  if (drivenAll.length === 0 && pending.length === 0) {
    return [`${head}\nไม่มีงานที่บันทึกไว้ในเดือนนี้`];
  }

  // ก๊อปได้: หัว + รายการ + ยอดรวม ใส่ใน <pre> (แตะค้างก๊อปทั้งก้อนได้) แบ่งก้อนตามเพดาน
  const bodyRows = driven.map(row);
  const chunks: string[] = [];
  let cur: string[] = [];
  let len = head.length + foot.length + 50;
  for (const r of bodyRows) {
    if (len + r.length > TELEGRAM_CHUNK && cur.length > 0) {
      chunks.push(cur.join('\n'));
      cur = [];
      len = head.length + 50;
    }
    cur.push(r);
    len += r.length + 1;
  }
  if (cur.length > 0 || bodyRows.length === 0) chunks.push(cur.join('\n'));

  const out = chunks.map((c, i) => {
    const isLast = i === chunks.length - 1;
    const text = [head + (chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : ''), c, isLast ? foot : ''].filter(Boolean).join('\n');
    return `<pre>${escapeHtml(text)}</pre>`;
  });

  const warn: string[] = [];
  if (pending.length > 0) warn.push(`⏳ ยังไม่ได้ยืนยัน ${pending.length} งาน (ยังไม่นับในยอด): ${pending.map((j) => `${dayLabelTh(j.job_date)} ${j.booking_ref || j.guest_name || ''}`.trim()).join(', ')}`);
  if (unpriced.length > 0) warn.push(`⚠️ ขับจริงแต่ยังไม่มีราคา ${unpriced.length} งาน (ไม่อยู่ในข้อความด้านบน): ${unpriced.map((j) => `${dayLabelTh(j.job_date)} ${j.booking_ref || j.guest_name || ''}`.trim()).join(', ')} — ใส่ราคาก่อนส่ง`);
  if (warn.length > 0) out.push(escapeHtml(warn.join('\n')));
  return out;
}

/** สรุปทุกเพื่อนที่มีงานในเดือนนั้น (ใช้ทั้ง /สรุป และ cron วันที่ 1) */
export async function buildMonthlySummaries(month: string, onlyOwnerId?: string): Promise<string[]> {
  const [jobs, owners] = await Promise.all([listSideJobs(), listOwners()]);
  const ids = new Set(jobs.filter((j) => j.job_date.startsWith(month) && j.status !== 'cancelled').map((j) => j.owner_id));
  const targets = owners.filter((o) => ids.has(o.owner_id) && (!onlyOwnerId || o.owner_id === onlyOwnerId));
  if (targets.length === 0) return [`ไม่มีงานที่บันทึกไว้ในเดือน${monthLabelTh(month)}${onlyOwnerId ? ' ของคนนี้' : ''}`];
  return targets.flatMap((o) => buildOwnerSummary(jobs, o, month));
}

// ---------------------------------------------------------------- อ่านคำสั่ง /สรุป และค่าใช้จ่ายเพิ่ม

const MONTH_TOKENS: Array<[string, number]> = [
  ['มกราคม', 1], ['มกรา', 1], ['มค', 1], ['jan', 1], ['january', 1],
  ['กุมภาพันธ์', 2], ['กุมภา', 2], ['กพ', 2], ['feb', 2], ['february', 2],
  ['มีนาคม', 3], ['มีนา', 3], ['มีค', 3], ['mar', 3], ['march', 3],
  ['เมษายน', 4], ['เมษา', 4], ['เมย', 4], ['apr', 4], ['april', 4],
  ['พฤษภาคม', 5], ['พฤษภา', 5], ['พค', 5], ['may', 5],
  ['มิถุนายน', 6], ['มิถุนา', 6], ['มิย', 6], ['jun', 6], ['june', 6],
  ['กรกฎาคม', 7], ['กรกฎา', 7], ['กค', 7], ['jul', 7], ['july', 7],
  ['สิงหาคม', 8], ['สิงหา', 8], ['สค', 8], ['aug', 8], ['august', 8],
  ['กันยายน', 9], ['กันยา', 9], ['กย', 9], ['sep', 9], ['sept', 9], ['september', 9],
  ['ตุลาคม', 10], ['ตุลา', 10], ['ตค', 10], ['oct', 10], ['october', 10],
  ['พฤศจิกายน', 11], ['พฤศจิกา', 11], ['พย', 11], ['nov', 11], ['november', 11],
  ['ธันวาคม', 12], ['ธันวา', 12], ['ธค', 12], ['dec', 12], ['december', 12],
];

export type SummaryArgs = { ok: true; owner: Owner | null; month: string } | { ok: false; error: string };

/**
 * "/สรุป" ตามด้วยชื่อเพื่อนและ/หรือเดือนได้ทุกลำดับ — เช่น "ชื่อเพื่อน", "ต.ค.", "ชื่อเพื่อน ตุลาคม 2569", "2026-10", "10"
 * ไม่ใส่เดือน = เดือนปัจจุบัน; ไม่ใส่ชื่อ = ทุกคน; เดือนที่ยังไม่มาถึงในปีนี้ (ไม่ระบุปี) ตีความเป็นปีก่อน
 * คำที่อ่านไม่ออก = error (ไม่เดา ไม่ปล่อยให้ได้สรุปผิดเดือน/ผิดคน)
 */
export function parseSummaryArgs(args: string, owners: Owner[], now = Date.now()): SummaryArgs {
  const [curY, curM] = bangkokToday(now).split('-').map(Number);
  let owner: Owner | null = null;
  let month: number | null = null;
  let year: number | null = null;
  let explicit: string | null = null;

  for (const raw of args.split(/\s+/).filter(Boolean)) {
    const tok = raw.toLowerCase().replace(/[.,]/g, '');
    const ym = tok.match(/^(\d{4})-(\d{1,2})$/);
    if (ym) {
      explicit = `${ym[1]}-${ym[2].padStart(2, '0')}`;
      continue;
    }
    if (/^\d{4}$/.test(tok)) {
      const y = Number(tok);
      year = y >= 2500 ? y - 543 : y;
      continue;
    }
    if (/^\d{1,2}$/.test(tok) && Number(tok) >= 1 && Number(tok) <= 12) {
      month = Number(tok);
      continue;
    }
    const mt = MONTH_TOKENS.find(([name]) => name === tok);
    if (mt) {
      month = mt[1];
      continue;
    }
    const o = resolveOwner(raw, owners);
    if (o) {
      owner = o;
      continue;
    }
    return { ok: false, error: `อ่าน "${raw}" ไม่ออก — ใส่ชื่อเพื่อน (${owners.map((x) => x.display_name).join('/')}) และ/หรือเดือน เช่น /สรุป ชื่อเพื่อน ต.ค.` };
  }

  if (explicit) {
    const m = Number(explicit.slice(5));
    if (m < 1 || m > 12) return { ok: false, error: `เดือนไม่ถูกต้อง: ${explicit}` };
    return { ok: true, owner, month: explicit };
  }
  const m = month ?? curM;
  let y = year ?? curY;
  if (year === null && month !== null && month > curM) y = curY - 1;
  return { ok: true, owner, month: `${y}-${String(m).padStart(2, '0')}` };
}

/**
 * ค่าใช้จ่ายเพิ่มที่แชมป์พิมพ์ เช่น "150", "150 ค่าจอด", "ค่าจอด 150 บาท" → ตัวเลข + โน้ต
 * มีตัวเลขเดียวเท่านั้น (หลายตัว = กำกวม ให้ถามใหม่ ไม่เดาว่าจะรวมหรือไม่)
 */
export function parseExtra(text: string): { cost: number; note: string } | null {
  // ตัวเลขต้องเป็นคำเดี่ยว (ไม่ติดตัวอักษร/ตัวเลขอื่น) — กัน "VTL3036" ถูกอ่านเป็นค่าใช้จ่าย 3036
  const nums = text.match(/(?<![A-Za-z0-9])\d[\d,]*(?:\.\d+)?(?![A-Za-z0-9])/g);
  if (!nums || nums.length !== 1) return null;
  const cost = Number(nums[0].replace(/,/g, ''));
  if (!Number.isFinite(cost) || cost <= 0) return null;
  const note = text.replace(nums[0], ' ').replace(/บาท|฿|baht|thb/gi, ' ').replace(/\s+/g, ' ').trim();
  return { cost, note };
}

/** ข้อความถาม "ขับจริงไหม" ของงานที่ผ่านวันงานแล้ว (เช้าวันถัดไป) */
export function confirmationText(j: SideJob, ownerNameTh: string): string {
  return [
    `🕘 <b>ขับจริงไหมครับ?</b> — ${escapeHtml(ownerNameTh)}`,
    `📅 ${dayLabelTh(j.job_date)}${j.pickup_time ? ` ${escapeHtml(j.pickup_time)}` : ''}${j.booking_ref ? ` | ${escapeHtml(j.booking_ref)}` : ''}`,
    `🚐 ${escapeHtml(routeText(j))}${j.pax ? ` | ${escapeHtml(j.pax)} คน` : ''}${j.agent_price ? ` | ${baht(num(j.agent_price))} บาท` : ' | ⚠️ ยังไม่มีราคา'}`,
    `<code>${escapeHtml(j.job_id)}</code>`,
  ].join('\n');
}

export function confirmedText(j: SideJob, ownerNameTh: string): string {
  const base = confirmationText(j, ownerNameTh).split('\n').slice(1).join('\n');
  const extra = num(j.extra_cost);
  const tail = j.status === 'driven' ? `✅ <b>ขับจริง</b>${extra ? ` (+${baht(extra)}${j.extra_note ? ` ${escapeHtml(j.extra_note)}` : ''})` : ''}` : '❌ <b>ไม่ได้ขับ</b> (ไม่นับในสรุป)';
  return `${tail} — ${escapeHtml(ownerNameTh)}\n${base}`;
}
