// lib/prices.ts — ราคา transfer จาก Google Sheet "krabi transfer price update"
// แท็บ `Prices` (from_zone, to_zone, price_1_3, price_4_8, note, active) แถวละ 1 ทิศ
// แท็บ `Aliases` (name, zone) ชื่อที่ลูกค้าพิมพ์ → zone
// แชมป์แก้ราคาใน Sheet ที่เดียว บอทเห็นภายใน CACHE_TTL_MS โดยไม่ต้อง deploy
//
// ตัวเลขราคามาจากฟังก์ชันนี้เท่านั้น (Gemini เรียกผ่าน tool lookup_price) ไม่ให้ LLM คิดเลขเอง
// เส้นที่ไม่มีแถวใน Sheet = not_found → ส่งต่อแชมป์ ห้ามเดา (กฎราคาใน CLAUDE.md)

import { log } from './log';
import { norm } from './text-norm';
import { loadLearnedAliases } from './place-zones';

// ชีตเปิดแบบ "ทุกคนที่มีลิงก์ดูได้" อยู่แล้ว ใช้ gviz CSV ได้เลย ไม่ต้องมี key
const DEFAULT_PRICE_SHEET_ID = '1sqITrRjl6vvm1NZy9KkmNZOgj2knoVuS4xNBkwY35YQ';
const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 5000;
// ราคาในชีตราคา (แท็บ Prices) = "ราคา Agent" (ราคาที่ CTT เรียกเก็บจาก Agent/บริษัททัวร์ ใช้ทำบิลเบิก)
// ราคาที่บอทบอก "ลูกค้า" = ราคา Agent + 15% แล้วปัดเป็นหลักร้อยที่ใกล้ที่สุด (แชมป์สั่ง 8 ต.ค. 2026: ราคา Agent กับราคาขายลูกค้าเป็นคนละราคา)
// ปรับ/ปิดได้ด้วย env CUSTOMER_MARKUP (เช่น 1.15; ตั้งเป็น 1 = ไม่บวก) — แก้ที่ Vercel ไม่ต้อง deploy โค้ด
// ผลกระทบ: Stripe Payment Link ประจำเส้นทางในชีต (คอลัมน์ link_1_3/link_4_8) ล็อกราคา Agent ไว้ → ปิดใช้เมื่อมีการบวก
//          ระบบจะสร้าง Checkout Session ตามยอดใหม่แทน (ทางเดียวกับเส้นที่ไม่มี Payment Link)
const CUSTOMER_MARKUP = (() => {
  const v = Number(process.env.CUSTOMER_MARKUP ?? '1.15');
  return Number.isFinite(v) && v >= 1 && v <= 3 ? v : 1.15;
})();
/**
 * ราคา Agent → ราคาขายลูกค้า: คูณ markup แล้วปัดเป็นหลักร้อยที่ใกล้ที่สุด (ตั้งแต่ครึ่งร้อยขึ้นไปปัดขึ้น)
 * กติกาจากแชมป์ 8 ต.ค. 2026: 690 → 700 (ถึง 650 ขึ้นไปปัดขึ้น), 805 → 800 (ไม่ถึง 850 ปัดลง), 3,220 → 3,200
 * ปรับหน่วยปัดด้วย env CUSTOMER_ROUND_UNIT (ค่าเริ่มต้น 100; ตั้ง 1 = ปัดเป็นบาทเต็ม) — +1e-9 กันเศษทศนิยมลอยตัว (เช่น 1,149.9999)
 */
const ROUND_UNIT = (() => {
  const v = Number(process.env.CUSTOMER_ROUND_UNIT ?? '100');
  return Number.isFinite(v) && v >= 1 ? v : 100;
})();
export function retailPrice(agentPrice: number): number {
  return Math.floor((agentPrice * CUSTOMER_MARKUP) / ROUND_UNIT + 0.5 + 1e-9) * ROUND_UNIT;
}
const MARKUP_ACTIVE = CUSTOMER_MARKUP !== 1;

// ช่วงราคา 4-9 คน (แชมป์ยืนยัน 8 ต.ค. 2026: รถตู้นั่งสูงสุด 9 คน, 9 คนใช้ราคาช่วง 4-8 เดิม) — เกิน 9 คนใช้ groupOptions()
const MAX_PAX_FOR_PRICE = 9;
const VAN_MAX_PAX = 9;
const CAR_MAX_PAX = 3; // รถเก๋ง/SUV รับได้สูงสุด 3 คน (แชมป์ยืนยัน 8 ต.ค. 2026) → เสนอรถตู้ 9 + เก๋ง/SUV ได้เฉพาะกลุ่ม 10-12 คน
const ALLOW_REVERSE_PRICE = true;

// ชื่อสถานที่ → zone ที่แชมป์ยืนยันแล้ว (8 ต.ค. 2026): โรงแรมย่านคลองแห้ง อ่าวนาง ใช้ราคาอ่าวนาง ไม่ต้องรอแชมป์ยืนยัน
// ควรเพิ่มชื่อเหล่านี้ในแท็บ Aliases ของชีตราคาด้วย (ชีตมาก่อนเสมอ) — รายการนี้เป็นตัวสำรองระหว่างนั้น
const EXTRA_ALIASES: Array<[string, string]> = [
  ['De Malee Krabi', 'Ao Nang'],
  ['De Malee', 'Ao Nang'],
  ['คลองแห้ง', 'Ao Nang'],
  ['Klong Haeng', 'Ao Nang'],
  ['Khlong Haeng', 'Ao Nang'],
  ['Klong Hang', 'Ao Nang'],
  ['Khlong Hang', 'Ao Nang'],
];

interface PriceRow {
  from: string; // zone name (ตามที่เขียนใน Sheet)
  to: string;
  price13: number;
  price48: number;
  note: string;
  sedan?: number; // ราคารถเก๋งต่อคัน "ราคาขายลูกค้า" (จากคอลัมน์ price_sedan = ราคา Agent แล้วบวกเพิ่ม; ว่าง = ยังไม่มีราคา)
  suv?: number; // ราคา SUV ต่อคัน ราคาขายลูกค้า (คอลัมน์ price_suv)
  link13: string; // Stripe Payment Link (ว่าง = ไม่มีลิงก์ประจำเส้นทางนี้)
  link48: string;
}

interface PriceData {
  rows: PriceRow[];
  rowIndex: Map<string, PriceRow>; // key = norm(from)|norm(to)
  aliases: Map<string, string[]>; // norm(name) → zone(s) ชื่อเดียวมีได้หลาย zone เรียงตามลำดับแถวใน Sheet (เจาะจงก่อน กว้างทีหลัง)
  zoneNames: Map<string, string>; // norm(zone) → zone (ชื่อ zone จริงจากคอลัมน์ from/to)
  byFrom: Map<string, PriceRow[]>; // norm(from_zone) → ทุกปลายทางที่มีราคาจากต้นทางนี้ (ใช้ทำตารางราคา)
}

let cache: { data: PriceData; expiresAt: number } | null = null;

export type PriceLookupResult =
  | { status: 'ok'; from: string; to: string; pax: number; paxBand: '1-3' | '4-9'; price: number; note: string; paymentLink?: string }
  | { status: 'ambiguous'; place: string; options: string[]; message: string }
  | { status: 'handoff'; reason: string; message: string }
  | { status: 'not_found'; message: string };

// คำกว้างที่ลูกค้าพิมพ์แล้วยังไม่รู้ว่าหมายถึงสนามบินหรือเข้าเมือง ต้องถามกลับก่อนตอบราคา
const AMBIGUOUS_PLACES: Record<string, string[]> = {
  ภูเก็ต: ['Phuket Airport', 'Phuket Zone'],
  phuket: ['Phuket Airport', 'Phuket Zone'],
};

export function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (inQuotes) {
      if (ch === '"' && csv[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && csv[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur !== '' || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

async function fetchTab(tab: string): Promise<string[][]> {
  const sheetId = process.env.PRICE_SHEET_ID || DEFAULT_PRICE_SHEET_ID;
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`price sheet ${tab} fetch failed: ${res.status}`);
  return parseCsv(await res.text());
}

// รับเฉพาะลิงก์ Payment Link ของ Stripe (https://buy.stripe.com/...) กันค่าผิด/ลิงก์แปลกปลอมในชีตหลุดไปถึงลูกค้า
function safePaymentLink(s: string | undefined): string {
  const v = (s ?? '').trim();
  return /^https:\/\/buy\.stripe\.com\/[A-Za-z0-9_]+$/.test(v) ? v : '';
}

function toNumber(s: string): number {
  return Number(String(s).replace(/[,\s]/g, ''));
}

function buildData(priceRows: string[][], aliasRows: string[][], learned: Array<[string, string]> = []): PriceData {
  const rows: PriceRow[] = [];
  const rowIndex = new Map<string, PriceRow>();
  const zoneNames = new Map<string, string>();
  const byFrom = new Map<string, PriceRow[]>();

  // อ่านคอลัมน์ตามชื่อหัวตาราง (เติมคอลัมน์ price_sedan / price_suv ตรงไหนของแท็บ Prices ก็ได้) ถ้าไม่เจอชื่อใช้ลำดับเดิม
  const header = (priceRows[0] ?? []).map((h) => (h ?? '').trim().toLowerCase());
  const col = (name: string, fallback: number) => {
    const i = header.indexOf(name);
    return i >= 0 ? i : fallback;
  };
  const iFrom = col('from_zone', 0), iTo = col('to_zone', 1), i13 = col('price_1_3', 2), i48 = col('price_4_8', 3);
  const iNote = col('note', 4), iActive = col('active', 5), iL13 = col('link_1_3', 6), iL48 = col('link_4_8', 7);
  const iSedan = header.indexOf('price_sedan'), iSuv = header.indexOf('price_suv');
  const posNum = (s: string | undefined) => {
    const n = toNumber(s ?? '');
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  for (const r of priceRows.slice(1)) {
    const c = r.map((x) => (x ?? '').trim());
    const [from, to, p13, p48, note, active, l13, l48] = [c[iFrom], c[iTo], c[i13], c[i48], c[iNote], c[iActive], c[iL13], c[iL48]];
    if (!from || !to) continue;
    if (active && active.toUpperCase() !== 'TRUE') continue;
    const agent13 = toNumber(p13);
    const agent48 = toNumber(p48);
    if (!Number.isFinite(agent13) || !Number.isFinite(agent48) || agent13 <= 0 || agent48 <= 0) continue;
    const price13 = retailPrice(agent13);
    const price48 = retailPrice(agent48);
    const row: PriceRow = {
      from, to, price13, price48, note: note ?? '',
      // Payment Link ในชีตล็อกราคา Agent — ใช้ได้เฉพาะตอนไม่บวกราคา (ไม่งั้นลูกค้าจ่ายราคา Agent และยอดไม่ตรง pending)
      link13: MARKUP_ACTIVE ? '' : safePaymentLink(l13),
      link48: MARKUP_ACTIVE ? '' : safePaymentLink(l48),
      sedan: iSedan >= 0 && posNum(c[iSedan]) ? retailPrice(posNum(c[iSedan])!) : undefined,
      suv: iSuv >= 0 && posNum(c[iSuv]) ? retailPrice(posNum(c[iSuv])!) : undefined,
    };
    rows.push(row);
    rowIndex.set(`${norm(from)}|${norm(to)}`, row);
    const fromList = byFrom.get(norm(from)) ?? [];
    fromList.push(row);
    byFrom.set(norm(from), fromList);
    zoneNames.set(norm(from), from);
    zoneNames.set(norm(to), to);
  }

  // ชีตเก็บราคารายทิศ แต่หัวชีตระบุว่า "ราคาใช้ได้ทั้งขาไปและขากลับ" — ถ้าทิศหนึ่งไม่มีแถว ให้ใช้ราคาของทิศตรงข้าม
  // แถวที่มีทั้งสองทิศ (ราคาต่างกันได้ เช่น Patong → สนามบิน) ใช้ตามแถวจริงเสมอ ไม่ถูกทับ
  // ปิดได้ด้วย ALLOW_REVERSE_PRICE=false (กฎ "ห้ามเดาราคา": เส้นที่ไม่มีแถวเลยทั้งสองทิศยังคง not_found)
  if (ALLOW_REVERSE_PRICE) {
    for (const row of rows.slice()) {
      const rk = `${norm(row.to)}|${norm(row.from)}`;
      if (rowIndex.has(rk)) continue;
      // แถวที่ชีตระบุ "เส้นเฉพาะ" (เช่น Patong → สนามบิน จากแท็บ อื่นๆ) ไม่สร้างขากลับ: ไม่เช่นนั้น สนามบิน → Patong จะกลายเป็นราคาเส้นเฉพาะ
      // ทั้งที่ราคาจริงคือราคาโซนภูเก็ตของสนามบิน (ป่าตอง/กะตะ/กะรน/กมลา)
      if (/เส้นเฉพาะ/.test(row.note)) continue;
      const rev: PriceRow = { ...row, from: row.to, to: row.from, note: row.note || 'ใช้ราคาขากลับของเส้นเดิม' };
      rows.push(rev);
      rowIndex.set(rk, rev);
      zoneNames.set(norm(rev.from), rev.from);
      const lst = byFrom.get(norm(rev.from)) ?? [];
      lst.push(rev);
      byFrom.set(norm(rev.from), lst);
    }
  }

  const aliases = new Map<string, string[]>();
  const addAlias = (name: string, zone: string) => {
    const key = norm(name);
    const list = aliases.get(key) ?? [];
    if (!list.includes(zone)) list.push(zone);
    aliases.set(key, list);
  };
  for (const r of aliasRows.slice(1)) {
    const [name, zone] = r.map((c) => (c ?? '').trim());
    if (!name || !zone) continue;
    addAlias(name, zone);
  }
  // alias ที่แชมป์สั่งเพิ่มในโค้ด (ชีตมาก่อนเสมอ — ถ้าชีตมีชื่อเดียวกัน ใช้ zone ของชีตก่อน)
  for (const [name, zone] of EXTRA_ALIASES) {
    if (zoneNames.has(norm(zone))) addAlias(name, zone);
  }
  // ชื่อสถานที่ที่บอทเรียนรู้จากแชทลูกค้า (lib/place-zones.ts) — ต่อท้ายสุด ชีตและ alias ในโค้ดมาก่อนเสมอ
  for (const [name, zone] of learned) {
    if (zoneNames.has(norm(zone))) addAlias(name, zone);
  }

  return { rows, rowIndex, aliases, zoneNames, byFrom };
}

export async function loadPrices(): Promise<PriceData> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.data;

  try {
    const [priceRows, aliasRows, learned] = await Promise.all([fetchTab('Prices'), fetchTab('Aliases'), loadLearnedAliases().catch(() => [] as Array<[string, string]>)]);
    const data = buildData(priceRows, aliasRows, learned);
    if (data.rows.length === 0) throw new Error('price sheet has no valid rows');
    cache = { data, expiresAt: now + CACHE_TTL_MS };
    return data;
  } catch (err) {
    // ดึงใหม่ไม่ได้ → ใช้ cache เก่า (ราคาเก่า 1-2 นาทีดีกว่าตอบไม่ได้) ถ้าไม่มีเลยค่อย throw
    if (cache) {
      log.warn('prices.fetch_failed_serving_stale', { err: (err as Error).message });
      return cache.data;
    }
    throw err;
  }
}

/** ผู้สมัคร zone ของชื่อสถานที่ที่ลูกค้าพิมพ์ — เรียงตามความเจาะจง (ชื่อ zone ตรงๆ ก่อน แล้วค่อย alias) */
function candidateZones(place: string, data: PriceData): string[] {
  const key = norm(place);
  const out: string[] = [];
  const direct = data.zoneNames.get(key);
  if (direct) out.push(direct);
  const alias = data.aliases.get(key);
  if (alias) out.push(...alias);

  if (out.length === 0) {
    // ไม่ตรงเป๊ะ → หา alias/zone ที่ยาวที่สุดที่ปรากฏอยู่ในข้อความ (เช่น "Avani Krabi Resort" มี "avanikrabi")
    let best: { len: number; zones: string[] } | null = null;
    for (const [name, zones] of Array.from(data.aliases.entries())) {
      if (name.length >= 3 && key.includes(name) && (!best || name.length > best.len)) {
        best = { len: name.length, zones };
      }
    }
    if (best) out.push(...best.zones);
  }
  return Array.from(new Set(out));
}

/** zone ที่รู้จักในข้อความอิสระ (เช่น "สอบถามราคารถ สนามบินกระบี่" → Krabi Airport) ใช้ตรวจว่าลูกค้าพูดถึงสถานที่ในตารางหรือไม่ */
export async function zonesInText(text: string): Promise<string[]> {
  const data = await loadPrices();
  return candidateZones(text, data);
}

export async function lookupPrice(origin: string, destination: string, pax: number): Promise<PriceLookupResult> {
  if (!Number.isFinite(pax) || pax < 1) {
    return { status: 'handoff', reason: 'invalid_pax', message: 'ยังไม่ทราบจำนวนคน ให้ถามลูกค้าก่อน' };
  }
  if (pax > MAX_PAX_FOR_PRICE) {
    return {
      status: 'handoff',
      reason: 'pax_over_9',
      message:
        'เกิน 9 คน รถตู้ 1 คันไม่พอ ให้เรียก tool group_options(origin, destination, pax) เพื่อเสนอ 2 ทางเลือก (รถตู้หลายคัน / รถตู้ + รถเก๋งหรือ SUV) ห้ามคิดราคาเอง',
    };
  }

  const data = await loadPrices();

  for (const place of [origin, destination]) {
    const amb = AMBIGUOUS_PLACES[norm(place)];
    if (amb) {
      return {
        status: 'ambiguous',
        place,
        options: amb,
        message: `"${place}" ยังไม่ชัดเจน ให้ถามลูกค้าว่าไปสนามบินภูเก็ต หรือเข้าเมือง/ย่านชายหาด (ป่าตอง กะตะ กะรน กมลา)`,
      };
    }
  }

  const fromZones = candidateZones(origin, data);
  const toZones = candidateZones(destination, data);

  for (const f of fromZones) {
    for (const t of toZones) {
      const row = data.rowIndex.get(`${norm(f)}|${norm(t)}`);
      if (!row) continue;
      const small = pax <= 3;
      return {
        status: 'ok',
        from: row.from,
        to: row.to,
        pax,
        paxBand: small ? '1-3' : '4-9',
        price: small ? row.price13 : row.price48,
        note: row.note,
        paymentLink: (small ? row.link13 : row.link48) || undefined,
      };
    }
  }

  log.info('prices.not_found', { origin, destination, fromZones, toZones });
  return {
    status: 'not_found',
    message:
      fromZones.length === 0 || toZones.length === 0
        ? 'ยังไม่ทราบย่านของสถานที่นี้ (ห้ามพูดว่า "ระบบไม่รู้จัก/ไม่พบ") — ถ้าเป็นชื่อโรงแรม/ที่พัก/สถานที่ในกระบี่ พังงา ภูเก็ต ให้ถามลูกค้าสั้นๆ ว่าอยู่ย่านไหน (เช่น อ่าวนาง คลองแห้ง ภูเก็ต เขาหลัก) แล้วเรียก lookup_price ใหม่โดยใช้ชื่อย่านเป็นปลายทาง; ถ้าเป็นจังหวัด/เกาะ/เมืองไกลที่ชัดเจนว่าไม่อยู่ในตาราง (เช่น เกาะสมุย เกาะพะงัน หัวหิน เชียงใหม่) ห้ามถามย่าน ให้แจ้งว่าพี่แชมป์จะเช็คราคาให้ แล้วใส่ [HANDOFF]'
        : 'ยังไม่มีราคาเส้นทางนี้ในตาราง ห้ามเดาราคา ให้แจ้งว่าพี่แชมป์จะเช็คราคาให้และส่งต่อแชมป์',
  };
}

// ============================================================
// กลุ่มเกิน 9 คน: เสนอ 2 ทางเลือก (แชมป์สั่ง 8 ต.ค. 2026) — (1) รถตู้หลายคัน (2) รถตู้ 1 คัน + รถเก๋งหรือ SUV (เฉพาะ 10-12 คน)
// ราคารถเก๋ง/SUV อ่านจากคอลัมน์ price_sedan / price_suv ในแท็บ Prices (แชมป์เติมเอง) ถ้ายังว่าง = null → ให้พี่แชมป์แจ้ง
// ============================================================

export type GroupOptionsResult =
  | {
      status: 'ok';
      pax: number;
      from: string;
      to: string;
      vans: { count: number; paxPerVan: number[]; pricePerVan: number; total: number };
      vanPlusCar: null | {
        vanPax: number;
        carPax: number;
        vanPrice: number;
        sedan: null | { price: number; total: number };
        suv: null | { price: number; total: number };
      };
      instruction: string;
    }
  | { status: 'ambiguous'; message: string }
  | { status: 'handoff'; message: string }
  | { status: 'not_found'; message: string };

export async function groupOptions(origin: string, destination: string, pax: number): Promise<GroupOptionsResult> {
  if (!Number.isFinite(pax) || pax <= VAN_MAX_PAX) {
    return { status: 'handoff', message: 'ไม่เกิน 9 คนนั่งรถตู้คันเดียวได้ ให้ใช้ lookup_price แทน' };
  }
  if (pax > VAN_MAX_PAX * 3) {
    return { status: 'handoff', message: 'เกิน 27 คนต้องจัดรถหลายคัน ห้ามคิดราคาเอง ให้แจ้งว่าพี่แชมป์จะแจ้งราคาให้และส่งต่อแชมป์' };
  }
  const data = await loadPrices();
  for (const place of [origin, destination]) {
    const amb = AMBIGUOUS_PLACES[norm(place)];
    if (amb) return { status: 'ambiguous', message: `"${place}" ยังไม่ชัดเจน ให้ถามลูกค้าว่าสนามบินภูเก็ตหรือเข้าเมือง/ย่านชายหาด` };
  }
  const fromZones = candidateZones(origin, data);
  const toZones = candidateZones(destination, data);
  let row: PriceRow | undefined;
  for (const f of fromZones) {
    for (const t of toZones) {
      row = row ?? data.rowIndex.get(`${norm(f)}|${norm(t)}`);
    }
  }
  if (!row) {
    return { status: 'not_found', message: 'ยังไม่มีราคาเส้นทางนี้ในตาราง ห้ามเดาราคา ให้แจ้งว่าพี่แชมป์จะแจ้งราคากลุ่มให้และส่งต่อแชมป์' };
  }

  const count = Math.ceil(pax / VAN_MAX_PAX);
  const base = Math.floor(pax / count);
  const paxPerVan = Array.from({ length: count }, (_, i) => base + (i < pax - base * count ? 1 : 0));
  // ทุกคันมีผู้โดยสาร >= 4 คน (pax >= 10 → คันละ >= 5) จึงใช้ราคาช่วง 4-9 คนต่อคัน
  const vans = { count, paxPerVan, pricePerVan: row.price48, total: count * row.price48 };

  let vanPlusCar: Extract<GroupOptionsResult, { status: 'ok' }>['vanPlusCar'] = null;
  const carPax = pax - VAN_MAX_PAX;
  if (carPax >= 1 && carPax <= CAR_MAX_PAX) {
    vanPlusCar = {
      vanPax: VAN_MAX_PAX,
      carPax,
      vanPrice: row.price48,
      sedan: row.sedan ? { price: row.sedan, total: row.price48 + row.sedan } : null,
      suv: row.suv ? { price: row.suv, total: row.price48 + row.suv } : null,
    };
  }
  return {
    status: 'ok',
    pax,
    from: row.from,
    to: row.to,
    vans,
    vanPlusCar,
    instruction:
      'เสนอให้ลูกค้าเลือก ' + (vanPlusCar ? '2 ทาง: (1) รถตู้ ' + count + ' คัน (2) รถตู้ 1 คัน + รถเก๋งหรือ SUV 1 คัน' : '1 ทาง: รถตู้ ' + count + ' คัน (กลุ่มนี้ไม่เหมาะกับรถตู้+เก๋ง)') +
      ' ใช้ตัวเลขจากผลลัพธ์เท่านั้น ถ้า sedan หรือ suv เป็น null ให้บอกว่าพี่แชมป์จะแจ้งราคาส่วนรถเก๋ง/SUV ห้ามเดาตัวเลข เมื่อลูกค้าเลือกแล้วให้ถามวัน/เวลา/จุดรับ/จุดส่งให้ครบ แล้วใส่ [HANDOFF] ให้พี่แชมป์จัดรถและยืนยัน ห้ามพิมพ์ [BOOKING_CONFIRMED] และห้ามสร้างลิงก์ชำระเงิน',
  };
}

// ============================================================
// ตารางราคาทุกปลายทางจากต้นทางเดียว (ส่งให้ลูกค้าดูเมื่อรู้ต้นทางแล้ว ไม่ต้องจับชื่อปลายทางให้ตรง)
// สร้างโดยโค้ด ไม่ให้ Gemini พิมพ์ตัวเลขเอง — ตัวเลขมาจากชีต Prices ปัจจุบันเสมอ
// ============================================================

export type Lang = 'thai' | 'english' | 'other';

// ชื่อที่แสดงให้ลูกค้า (ไทย/อังกฤษ) และกลุ่ม — zone ที่ไม่อยู่ในรายการนี้จะแสดงตามชื่อในชีต ในกลุ่ม "อื่นๆ"
// เพิ่ม zone ใหม่ในชีตแล้วยังใช้ได้ทันที (แค่ชื่อแสดงเป็นอังกฤษจนกว่าจะเพิ่มที่นี่)
const ZONE_LABELS: Record<string, { th: string; en: string; group: 0 | 1 | 2 }> = {
  'Krabi Airport': { th: 'สนามบินกระบี่', en: 'Krabi Airport', group: 0 },
  'Krabi Town': { th: 'เมืองกระบี่', en: 'Krabi Town', group: 0 },
  'Ao Nang': { th: 'อ่าวนาง', en: 'Ao Nang', group: 0 },
  'Klong Muang': { th: 'คลองม่วง', en: 'Klong Muang', group: 0 },
  Tubkaek: { th: 'ทับแขก', en: 'Tubkaek', group: 0 },
  'Ao Nam Mao': { th: 'อ่าวน้ำเมา', en: 'Ao Nam Mao', group: 0 },
  'Railay Pier': { th: 'ท่าเรือไร่เลย์', en: 'Railay Pier', group: 0 },
  'Thalane Pier': { th: 'ท่าเลน (เกาะยาว)', en: 'Thalane Pier (Koh Yao)', group: 0 },
  'Phuket Airport': { th: 'สนามบินภูเก็ต', en: 'Phuket Airport', group: 1 },
  'Phuket Zone': { th: 'ภูเก็ต: ป่าตอง/กะตะ/กะรน/กมลา', en: 'Phuket: Patong/Kata/Karon/Kamala', group: 1 },
  Patong: { th: 'ป่าตอง', en: 'Patong', group: 1 },
  'Phuket Town': { th: 'ภูเก็ตทาวน์', en: 'Phuket Town', group: 1 },
  Rawai: { th: 'ราไวย์', en: 'Rawai', group: 1 },
  'Nai Harn': { th: 'ในหาน', en: 'Nai Harn', group: 1 },
  'Khao Lak': { th: 'เขาหลัก', en: 'Khao Lak', group: 1 },
  'Khao Sok': { th: 'เขาสก', en: 'Khao Sok', group: 1 },
  'Phang Nga Town': { th: 'ตัวเมืองพังงา', en: 'Phang Nga Town', group: 1 },
  'Koh Lanta': { th: 'เกาะลันตา', en: 'Koh Lanta', group: 2 },
  Trang: { th: 'ตรัง', en: 'Trang', group: 2 },
  'Surat Town': { th: 'สุราษฎร์ธานี (ตัวเมือง)', en: 'Surat Thani Town', group: 2 },
  'Surat Train Station': { th: 'สถานีรถไฟสุราษฎร์ธานี (พุนพิน)', en: 'Surat Thani Train Station', group: 2 },
  'Donsak Pier': { th: 'ท่าเรือดอนสัก', en: 'Donsak Pier', group: 2 },
  'Hat Yai': { th: 'หาดใหญ่', en: 'Hat Yai', group: 2 },
};

const GROUP_TITLES: Record<Lang, [string, string, string]> = {
  thai: ['ในจังหวัดกระบี่', 'ภูเก็ต / พังงา', 'จังหวัดอื่น'],
  english: ['Within Krabi', 'Phuket / Phang Nga', 'Other provinces'],
  other: ['Within Krabi', 'Phuket / Phang Nga', 'Other provinces'],
};

const fmt = (n: number) => n.toLocaleString('en-US');

/** ชื่อย่านภาษาไทยสำหรับแสดงให้แชมป์ (เช่น Ao Nang → อ่าวนาง) */
export function zoneLabelTh(zone: string): string {
  return ZONE_LABELS[zone]?.th ?? zone;
}

// ข้อเสนอทัวร์วันเดย์ — ขึ้นครั้งเดียวต่อบทสนทนา (แชมป์สั่ง 8 ต.ค. 2026) ใช้ 🏝️ เป็นตัวจับว่าเคยเสนอไปแล้ว (ดู offersAlreadyMade)
const TOUR_OFFER_MARK = '🏝️';
const MENU_HEADER_MARKS = ['🚐 ราคารถรับ-ส่งจาก', '🚐 Van transfer prices from'];

export function tourOfferText(lang: Lang): string {
  return lang === 'thai'
    ? `${TOUR_OFFER_MARK} นอกจากรถรับ-ส่ง CTT ยังมีทัวร์วันเดย์ด้วยนะครับ เช่น ทัวร์ 4 เกาะ เกาะพีพี เกาะห้อง สนใจให้ส่งรายละเอียดและราคาไหมครับ?`
    : `${TOUR_OFFER_MARK} Besides transfers, we also offer day tours — e.g. 4-Island, Phi Phi Island and Hong Island. Would you like the details and prices?`;
}

/** ดูจากข้อความที่บอทเคยส่งในบทสนทนานี้ (history 48 ชม.) ว่าเคยส่งตารางราคา / เสนอทัวร์ไปแล้วหรือยัง */
export function offersAlreadyMade(history: Array<{ role: string; text: string }>): { menu: boolean; tour: boolean } {
  const modelTexts = history.filter((m) => m.role === 'model').map((m) => m.text);
  return {
    menu: modelTexts.some((t) => MENU_HEADER_MARKS.some((h) => t.includes(h))),
    tour: modelTexts.some((t) => t.includes(TOUR_OFFER_MARK)),
  };
}

export type PriceMenuResult =
  | { status: 'ok'; originZone: string; destinations: string[]; text: string }
  | { status: 'not_found' };

/**
 * ตารางราคาทุกปลายทางจากต้นทางที่ลูกค้าบอก (ชื่อสถานที่/โรงแรมใดๆ ก็ได้ ระบบแปลงเป็นโซนเอง)
 * pax: ถ้ารู้จำนวนคน (1-9) แสดงราคาช่วงนั้นช่วงเดียว ไม่งั้นแสดงทั้ง 1-3 / 4-8 คน
 * ท้ายตารางมีคำถามปลายทาง + เสนอทัวร์วันเดย์ (ไม่ใส่ราคาทัวร์ ราคาทัวร์ให้ตอบจาก FAQ เมื่อลูกค้าสนใจ)
 */
export async function priceMenu(origin: string, lang: Lang, pax?: number, opts: { includeTourOffer?: boolean } = {}): Promise<PriceMenuResult> {
  const data = await loadPrices();
  let zone = '';
  let rows: PriceRow[] = [];
  for (const z of candidateZones(origin, data)) {
    const list = data.byFrom.get(norm(z));
    if (list && list.length > 0) {
      zone = z;
      rows = list;
      break;
    }
  }
  if (rows.length === 0) return { status: 'not_found' };

  const thai = lang === 'thai';
  const small = pax !== undefined && Number.isFinite(pax) && pax >= 1 && pax <= MAX_PAX_FOR_PRICE ? pax <= 3 : undefined; // undefined = ไม่รู้จำนวนคน
  const label = (z: string) => ZONE_LABELS[z]?.[thai ? 'th' : 'en'] ?? z;
  const originLabel = label(zone);

  const groups: PriceRow[][] = [[], [], []];
  for (const r of rows) groups[ZONE_LABELS[r.to]?.group ?? 2].push(r);
  const titles = GROUP_TITLES[lang];

  const lines: string[] = [];
  lines.push(
    thai
      ? `🚐 ราคารถรับ-ส่งจาก ${originLabel} (ต่อรถตู้ 1 คัน รวมน้ำมัน ไม่มีค่าใช้จ่ายเพิ่ม)`
      : `🚐 Van transfer prices from ${originLabel} (per van, fuel included, no extra charges)`
  );
  if (small === undefined) lines.push(thai ? 'ราคาแสดงเป็น: 1-3 คน / 4-9 คน (บาท)' : 'Prices shown as: 1-3 people / 4-9 people (THB)');
  else lines.push(thai ? `สำหรับ ${pax} คน (บาท)` : `For ${pax} people (THB)`);

  groups.forEach((g, i) => {
    if (g.length === 0) return;
    g.sort((a, b) => a.price13 - b.price13 || label(a.to).localeCompare(label(b.to)));
    lines.push('', titles[i]);
    for (const r of g) {
      const price = small === undefined ? `${fmt(r.price13)} / ${fmt(r.price48)}` : fmt(small ? r.price13 : r.price48);
      lines.push(`• ${label(r.to)} — ${price}`);
    }
  });

  lines.push(
    '',
    thai
      ? 'ต้องการไปที่ไหน แจ้งชื่อสถานที่หรือโรงแรมได้เลยครับ (ถ้าไม่มีในรายการ พี่แชมป์จะเช็คราคาให้)'
      : 'Where would you like to go? Just tell us the place or hotel name (if it is not listed, we will check the price for you).',
    ...(opts.includeTourOffer === false ? [] : ['', tourOfferText(lang)])
  );

  return { status: 'ok', originZone: zone, destinations: rows.map((r) => label(r.to)), text: lines.join('\n') };
}
