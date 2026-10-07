// lib/prices.ts — ราคา transfer จาก Google Sheet "krabi transfer price update"
// แท็บ `Prices` (from_zone, to_zone, price_1_3, price_4_8, note, active) แถวละ 1 ทิศ
// แท็บ `Aliases` (name, zone) ชื่อที่ลูกค้าพิมพ์ → zone
// แชมป์แก้ราคาใน Sheet ที่เดียว บอทเห็นภายใน CACHE_TTL_MS โดยไม่ต้อง deploy
//
// ตัวเลขราคามาจากฟังก์ชันนี้เท่านั้น (Gemini เรียกผ่าน tool lookup_price) ไม่ให้ LLM คิดเลขเอง
// เส้นที่ไม่มีแถวใน Sheet = not_found → ส่งต่อแชมป์ ห้ามเดา (กฎราคาใน CLAUDE.md)

import { log } from './log';

// ชีตเปิดแบบ "ทุกคนที่มีลิงก์ดูได้" อยู่แล้ว ใช้ gviz CSV ได้เลย ไม่ต้องมี key
const DEFAULT_PRICE_SHEET_ID = '1sqITrRjl6vvm1NZy9KkmNZOgj2knoVuS4xNBkwY35YQ';
const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 5000;
const MAX_PAX_FOR_PRICE = 8;

interface PriceRow {
  from: string; // zone name (ตามที่เขียนใน Sheet)
  to: string;
  price13: number;
  price48: number;
  note: string;
}

interface PriceData {
  rows: PriceRow[];
  rowIndex: Map<string, PriceRow>; // key = norm(from)|norm(to)
  aliases: Map<string, string[]>; // norm(name) → zone(s) ชื่อเดียวมีได้หลาย zone เรียงตามลำดับแถวใน Sheet (เจาะจงก่อน กว้างทีหลัง)
  zoneNames: Map<string, string>; // norm(zone) → zone (ชื่อ zone จริงจากคอลัมน์ from/to)
}

let cache: { data: PriceData; expiresAt: number } | null = null;

export type PriceLookupResult =
  | { status: 'ok'; from: string; to: string; pax: number; paxBand: '1-3' | '4-8'; price: number; note: string }
  | { status: 'ambiguous'; place: string; options: string[]; message: string }
  | { status: 'handoff'; reason: string; message: string }
  | { status: 'not_found'; message: string };

// "สนามบิน ภูเก็ต" / "Phuket-Airport" / "phuket airport " → ตัวพิมพ์เล็ก ตัดช่องว่างและเครื่องหมาย
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFC')
    .replace(/[\s\-_.,()/]+/g, '')
    .trim();
}

// คำกว้างที่ลูกค้าพิมพ์แล้วยังไม่รู้ว่าหมายถึงสนามบินหรือเข้าเมือง ต้องถามกลับก่อนตอบราคา
const AMBIGUOUS_PLACES: Record<string, string[]> = {
  ภูเก็ต: ['Phuket Airport', 'Phuket Zone'],
  phuket: ['Phuket Airport', 'Phuket Zone'],
};

function parseCsv(csv: string): string[][] {
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

function toNumber(s: string): number {
  return Number(String(s).replace(/[,\s]/g, ''));
}

function buildData(priceRows: string[][], aliasRows: string[][]): PriceData {
  const rows: PriceRow[] = [];
  const rowIndex = new Map<string, PriceRow>();
  const zoneNames = new Map<string, string>();

  for (const r of priceRows.slice(1)) {
    const [from, to, p13, p48, note, active] = r.map((c) => (c ?? '').trim());
    if (!from || !to) continue;
    if (active && active.toUpperCase() !== 'TRUE') continue;
    const price13 = toNumber(p13);
    const price48 = toNumber(p48);
    if (!Number.isFinite(price13) || !Number.isFinite(price48) || price13 <= 0 || price48 <= 0) continue;
    const row: PriceRow = { from, to, price13, price48, note: note ?? '' };
    rows.push(row);
    rowIndex.set(`${norm(from)}|${norm(to)}`, row);
    zoneNames.set(norm(from), from);
    zoneNames.set(norm(to), to);
  }

  const aliases = new Map<string, string[]>();
  for (const r of aliasRows.slice(1)) {
    const [name, zone] = r.map((c) => (c ?? '').trim());
    if (!name || !zone) continue;
    const key = norm(name);
    const list = aliases.get(key) ?? [];
    if (!list.includes(zone)) list.push(zone);
    aliases.set(key, list);
  }

  return { rows, rowIndex, aliases, zoneNames };
}

export async function loadPrices(): Promise<PriceData> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.data;

  try {
    const [priceRows, aliasRows] = await Promise.all([fetchTab('Prices'), fetchTab('Aliases')]);
    const data = buildData(priceRows, aliasRows);
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

export async function lookupPrice(origin: string, destination: string, pax: number): Promise<PriceLookupResult> {
  if (!Number.isFinite(pax) || pax < 1) {
    return { status: 'handoff', reason: 'invalid_pax', message: 'ยังไม่ทราบจำนวนคน ให้ถามลูกค้าก่อน' };
  }
  if (pax > MAX_PAX_FOR_PRICE) {
    return {
      status: 'handoff',
      reason: 'pax_over_8',
      message: 'เกิน 8 คนต้องใช้รถมากกว่า 1 คัน ห้ามคิดราคาเอง ให้แจ้งว่าพี่แชมป์จะประเมินให้และส่งต่อแชมป์',
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
        paxBand: small ? '1-3' : '4-8',
        price: small ? row.price13 : row.price48,
        note: row.note,
      };
    }
  }

  log.info('prices.not_found', { origin, destination, fromZones, toZones });
  return {
    status: 'not_found',
    message:
      fromZones.length === 0 || toZones.length === 0
        ? 'ไม่รู้จักสถานที่นี้ ให้ถามลูกค้าว่าอยู่ย่านไหน (เช่น อ่าวนาง ภูเก็ต เขาหลัก) ถ้ายังไม่ทราบให้แจ้งว่าพี่แชมป์จะเช็คราคาให้'
        : 'ยังไม่มีราคาเส้นทางนี้ในตาราง ห้ามเดาราคา ให้แจ้งว่าพี่แชมป์จะเช็คราคาให้และส่งต่อแชมป์',
  };
}
