// lib/faq.ts — ค้น FAQ เฉพาะแถวที่เกี่ยวข้อง แทนการยัด FAQ ทั้งชีต (~19,000 โทเค็น) เข้า prompt ทุกข้อความ
//
// เหตุผล: 2026-10-07 15:49 Gemini ตอบว่างเปล่าเมื่อ prompt ใหญ่ ลูกค้าถูกทิ้ง (ดู lib/gemini.ts callModel)
// ชีต FAQ (SHEET_CSV_URL, คอลัมน์ หมวดหมู่ | คำถาม | คำตอบ) แชมป์แก้ได้ที่เดียว บอทเห็นภายใน CACHE_TTL_MS
//
// ระบบกันตอบผิด (แผนสำรอง):
//  - ตัดแถว "สคริปต์ตอบสำหรับแชมป์" (หมวดขึ้นต้นด้วยเลข "1. ..." "12. ...") และแถวที่ยังมีช่องว่าง [ราคา]/[X] ออกจากการค้นหา
//  - ตัดแถวราคารถรับส่งในหมวด Airport Transfer ออก (ราคาต้องมาจาก lookup_price ที่อ่านชีตราคาปัจจุบันเท่านั้น)
//  - คืนผลพร้อมระดับความมั่นใจ ok / weak / not_found — weak ห้ามตอบเป็นข้อเท็จจริง, not_found ส่งต่อแชมป์

import { EXTRA_FAQ } from './faq-extra';
import { parseCsv } from './prices';
import { log } from './log';

const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 6000;
const MAX_RESULTS = 6;

// เกณฑ์คะแนน (สัดส่วนน้ำหนักคำของคำถามลูกค้าที่พบในแถว FAQ) — ปรับจากการทดสอบกับชีตจริง
export const STRONG_SCORE = 0.6;
export const WEAK_SCORE = 0.35;

export interface FaqRow {
  id: number; // ลำดับแถวในชีต (ไม่นับหัวตาราง) ใช้ใน log
  category: string;
  question: string;
  answer: string;
}

export interface FaqHit extends FaqRow {
  score: number;
}

export type FaqSearchResult =
  | { status: 'ok' | 'weak'; results: { category: string; question: string; answer: string; score: number }[]; message: string }
  | { status: 'not_found' | 'error'; message: string };

interface Indexed {
  row: FaqRow;
  q: Set<string>;
  a: Set<string>;
}

interface FaqIndex {
  docs: Indexed[];
  idf: Map<string, number>;
  categories: string[]; // หมวดสำหรับลูกค้า (ยุบคู่ไทย/อังกฤษไม่ได้ ใช้ตามที่มีในชีต)
  excluded: { template: number; placeholder: number; priceCovered: number };
}

let cache: { index: FaqIndex; expiresAt: number } | null = null;

// ---------- การจัดประเภทแถว ----------
const TEMPLATE_CATEGORY = /^\s*\d+\s*[.)]\s*/; // "1. ทักทาย/เปิดบทสนทนา" = สคริปต์สำหรับแชมป์
const PLACEHOLDER = /\[(ราคา|x|ชื่อ|วันที่|เวลา|จำนวน|ลิงก์|link|name|date|price|amount|[^\]]{0,3})\]/i; // ช่องว่างที่ยังไม่กรอก
const PRICE = /\d[\d,]{2,}\s*(บาท|thb|฿|baht)|฿\s*\d/i;
const TRANSFER_CATEGORY = /airport\s*transfer|การรับ-?ส่ง/i;

// ---------- ตัดคำ (ไทยไม่มีช่องว่าง → ใช้ตัวอักษร 2 ตัวติดกัน; อังกฤษใช้คำ) ----------
const STOP = new Set(
  'the a an is are do does did you your yours can could i me my we our to of in on at for and or how what which much many it this that there with from be have has by as if any please pls'.split(' ')
);

// ตัวคั่น: ช่องว่าง เครื่องหมายวรรคตอน ASCII และวรรคตอน CJK/ทั่วไป
const SEPARATOR = /[\s!-\/:-@\[-`{-~\u2000-\u206F\u3000-\u303F\uFF00-\uFF0F]+/;
// วรรณยุกต์/ไม้ไต่คู้/การันต์ไทย — ตัดออกกันพิมพ์ผิดเล็กน้อย (เช่น "ไม่" กับ "ไม")
const THAI_MARKS = /[\u0E47-\u0E4E]/g;

export function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  // คำพ้องที่ลูกค้าใช้ต่างจากที่เขียนใน FAQ (ค้นแบบตัวอักษรแยกไม่ออกเอง) — เพิ่มได้ที่นี่เมื่อเจอคำใหม่
  const s = text
    .toLowerCase()
    .replace(/จ่ายเงิน|จ่ายตังค์?|จ่ายค่า/g, 'ชำระเงิน')
    .replace(THAI_MARKS, '');
  for (const word of s.split(SEPARATOR)) {
    if (!word) continue;
    // แยกส่วน ASCII (a-z 0-9) ออกจากส่วนที่เป็นตัวอักษรภาษาอื่น (ไทย จีน ฮีบรู ฯลฯ)
    const parts = word.match(/[a-z0-9]+|[^a-z0-9]+/g) ?? [];
    for (const part of parts) {
      if (/^[a-z0-9]+$/.test(part)) {
        if (/^\d+$/.test(part) && part.length < 4) continue; // ตัวเลขล้วนสั้นๆ ไม่ใช่คำค้นที่มีความหมาย
        if (part.length >= 2 && !STOP.has(part)) out.add(part);
      } else {
        // ภาษาที่ไม่มีช่องว่างคั่นคำ: ใช้ตัวอักษร 2 ตัวติดกัน (bigram)
        const chars = Array.from(part);
        if (chars.length === 1) out.add(chars[0]);
        for (let i = 0; i < chars.length - 1; i++) out.add(chars[i] + chars[i + 1]);
      }
    }
  }
  return out;
}

const STALE_PAYMENT_POLICY = /มัดจำ|deposit|รับชำระเงินวิธีไหน|ชำระเงินได้วิธีไหน|payment methods|foreign customers pay|รถตู้รับ-ส่งนั่งได้กี่คน|passengers does the transfer van seat/i;

function buildIndex(csvRows: string[][]): FaqIndex {
  const excluded = { template: 0, placeholder: 0, priceCovered: 0 };
  const docs: Indexed[] = [];
  const body = csvRows.slice(1); // ข้ามหัวตาราง

  body.forEach((r, i) => {
    const [category, question, answer] = [r[0], r[1], r[2]].map((c) => (c ?? '').trim());
    if (!question || !answer) return; // ยังไม่มีคำตอบ = บอทไม่ใช้ (ตรงกับพฤติกรรมเดิม)
    if (TEMPLATE_CATEGORY.test(category)) {
      excluded.template++;
      return;
    }
    // นโยบายเก่าในชีต (มัดจำ 30-50% / รับเงินสด / PayPal) ขัดกับนโยบายจริง — ไม่ให้ค้นเจอ จนกว่าแชมป์จะแก้แถวในชีต (ดู <payment_policy> ใน prompts.ts)
    if (STALE_PAYMENT_POLICY.test(question)) {
      excluded.placeholder++;
      return;
    }
    if (PLACEHOLDER.test(answer) || PLACEHOLDER.test(question)) {
      excluded.placeholder++;
      return;
    }
    if (TRANSFER_CATEGORY.test(category) && PRICE.test(answer)) {
      excluded.priceCovered++;
      return;
    }
    docs.push({ row: { id: i + 1, category, question, answer }, q: tokenize(question + ' ' + category), a: tokenize(answer) });
  });

  // แถวที่แชมป์อนุมัติแล้วจากโค้ด (lib/faq-extra.ts) — รวมกับแถวในชีต id เริ่มที่ 1001 กันชนกับเลขแถวในชีต
  EXTRA_FAQ.forEach((r, i) => {
    docs.push({ row: { id: 1001 + i, category: r.category, question: r.question, answer: r.answer }, q: tokenize(r.question + ' ' + r.category), a: tokenize(r.answer) });
  });

  const df = new Map<string, number>();
  for (const d of docs) {
    for (const t of Array.from(new Set(Array.from(d.q).concat(Array.from(d.a))))) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  const n = docs.length;
  for (const [t, c] of Array.from(df.entries())) idf.set(t, Math.log(1 + n / (1 + c)));

  const categories = Array.from(new Set(docs.map((d) => d.row.category)));
  return { docs, idf, categories, excluded };
}

async function loadIndex(): Promise<FaqIndex> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.index;
  try {
    const url = process.env.SHEET_CSV_URL;
    if (!url) throw new Error('SHEET_CSV_URL not set');
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`faq fetch failed: ${res.status}`);
    const index = buildIndex(parseCsv(await res.text()));
    if (index.docs.length === 0) throw new Error('faq has no usable rows');
    cache = { index, expiresAt: now + CACHE_TTL_MS };
    return index;
  } catch (err) {
    if (cache) {
      log.warn('faq.fetch_failed_serving_stale', { err: (err as Error).message });
      return cache.index;
    }
    throw err;
  }
}

/** รายชื่อหมวด FAQ สำหรับลูกค้า (ใส่ใน prompt ให้ Gemini เลือกหมวด) */
export async function faqCategories(): Promise<string[]> {
  return (await loadIndex()).categories;
}

function coverage(query: Set<string>, doc: Set<string>, idf: Map<string, number>): number {
  let total = 0;
  let hit = 0;
  for (const t of Array.from(query)) {
    const w = idf.get(t) ?? Math.log(1 + 1); // คำที่ไม่เคยเจอใน FAQ ให้น้ำหนักต่ำ แต่ยังนับในตัวหาร
    total += w;
    if (doc.has(t)) hit += w;
  }
  return total === 0 ? 0 : hit / total;
}

/** คืนแถวที่ตรงที่สุดตามคะแนน (ใช้ทดสอบ/ดีบั๊ก) */
export function rank(index: FaqIndex, query: string, category?: string): FaqHit[] {
  const qTokens = tokenize(query);
  if (qTokens.size === 0) return [];
  const catKey = category ? tokenize(category) : null;
  const hits: FaqHit[] = [];
  for (const d of index.docs) {
    const cq = coverage(qTokens, d.q, index.idf); // ตรงกับคำถาม+หมวด
    const ca = coverage(qTokens, d.a, index.idf); // ตรงกับคำตอบ (ถ่วงน้ำหนักน้อยกว่า)
    let score = Math.max(cq, 0.7 * ca);
    if (catKey && catKey.size > 0 && coverage(catKey, tokenize(d.row.category), index.idf) > 0.6) score += 0.05; // หมวดที่โมเดลเลือกตรง → ดันขึ้นเล็กน้อย
    if (score > 0) hits.push({ ...d.row, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, MAX_RESULTS);
}

export async function searchFaq(query: string, category?: string): Promise<FaqSearchResult> {
  try {
    const index = await loadIndex();
    const hits = rank(index, query, category);
    const top = hits[0]?.score ?? 0;
    // log เฉพาะ metadata (ไม่ log ข้อความลูกค้า — PII)
    log.info('faq.search', { status: top >= STRONG_SCORE ? 'ok' : top >= WEAK_SCORE ? 'weak' : 'not_found', top: Number(top.toFixed(2)), ids: hits.map((h) => h.id), qLen: query.length });

    if (top < WEAK_SCORE) {
      return {
        status: 'not_found',
        message: 'ไม่มีข้อมูลเรื่องนี้ใน FAQ ห้ามตอบเอง ให้แจ้งลูกค้าว่าพี่แชมป์จะเช็คให้และติดต่อกลับ แล้วใส่ [HANDOFF]',
      };
    }
    const results = hits
      .filter((h) => h.score >= WEAK_SCORE)
      .map((h) => ({ category: h.category, question: h.question, answer: h.answer, score: Number(h.score.toFixed(2)) }));
    if (top >= STRONG_SCORE) {
      return { status: 'ok', results, message: 'ก่อนตอบ ตรวจว่า "question" ของแถวที่เลือกหมายถึงเรื่องเดียวกับที่ลูกค้าถามจริงๆ (ไม่ใช่แค่คำคล้ายกัน เช่น ลูกค้าถามที่นั่งเด็กแต่แถวเป็นทัวร์เหมาะกับเด็ก = คนละเรื่อง) ถ้าใช่ ตอบโดยใช้เฉพาะข้อมูลในคำตอบนั้น ห้ามเพิ่มข้อเท็จจริงใหม่ ถ้าไม่ใช่ ถือว่าไม่เจอ: แจ้งว่าพี่แชมป์จะเช็คให้ และใส่ [HANDOFF]' };
    }
    return {
      status: 'weak',
      results,
      message: 'ผลอาจไม่ตรงคำถาม ตอบได้เฉพาะเมื่อมีแถวที่ "question" หมายถึงเรื่องเดียวกับลูกค้าชัดเจน ถ้าไม่ชัด ห้ามตอบเป็นข้อเท็จจริง ให้ถามลูกค้ากลับ 1 ข้อให้ชัดขึ้น หรือถ้าเป็นเรื่องความปลอดภัย/ประกัน/เงิน/นโยบาย ให้ส่งต่อพี่แชมป์ [HANDOFF]',
    };
  } catch (err) {
    log.error('faq.search_failed', { err: (err as Error).message });
    return { status: 'error', message: 'ค้น FAQ ไม่ได้ชั่วคราว ห้ามตอบเอง แจ้งว่าพี่แชมป์จะเช็คให้ และใส่ [HANDOFF]' };
  }
}

// ส่งออกสำหรับสคริปต์ทดสอบ
export { buildIndex };
export type { FaqIndex };
