// lib/sheet.ts — FAQ cache (60-sec TTL + stale fallback)
// CSV format: question, answer, category (column A, B, C)

let cache: { text: string; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60_000; // 60 วินาที

export async function fetchFAQ(): Promise<string> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.text;

  try {
    const url = process.env.SHEET_CSV_URL;
    if (!url) throw new Error('SHEET_CSV_URL not set');

    const res = await fetch(url, {
      cache: 'no-store', // bypass Next.js cache · จัดการ cache เอง
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`sheet fetch failed: ${res.status}`);

    const csv = await res.text();
    const text = csvToFaqText(csv);

    cache = { text, expiresAt: now + CACHE_TTL_MS };
    return text;
  } catch (err) {
    // Graceful fallback · ถ้า fetch ล้ม ใช้ cache เก่าถ้ามี
    if (cache) {
      console.warn('[sheet] fetch failed · serving stale cache', err);
      return cache.text;
    }
    throw err;
  }
}

function csvToFaqText(csv: string): string {
  // CSV columns: question (A), answer (B), category (C)
  const lines = csv.split('\n').slice(1); // skip header row
  return lines
    .filter((line) => line.trim())
    .map((line) => {
      const [question, answer, category] = parseCSVLine(line);
      if (!question || !answer) return null;
      return `[${category || 'ทั่วไป'}] ${question}\n→ ${answer}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

function parseCSVLine(line: string): [string, string, string] {
  // CSV parser รองรับ quoted fields ที่มีลูกน้ำข้างใน
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if ((char === ',' || char === '\t') && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());

  return [result[0] || '', result[1] || '', result[2] || ''];
}
