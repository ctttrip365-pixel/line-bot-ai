interface FaqRow {
  question: string;
  answer: string;
  category: string;
}

interface Cache {
  data: FaqRow[];
  timestamp: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes

let cache: Cache | null = null;

function parseCsv(csv: string): FaqRow[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]);

  return lines
    .slice(1)
    .map((line) => {
      const values = splitCsvLine(line);
      const row: Record<string, string> = {};
      headers.forEach((h, i) => {
        row[h] = values[i] ?? '';
      });
      return {
        question: row['question'] ?? '',
        answer: row['answer'] ?? '',
        category: row['category'] ?? '',
      };
    })
    .filter((r) => r.question.trim() !== '');
}

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // handle escaped double-quote ""
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  values.push(current.trim());
  return values;
}

function formatFaq(rows: FaqRow[]): string {
  return rows.map((r) => `Q: ${r.question}\nA: ${r.answer}`).join('\n\n');
}

export async function getFaqText(): Promise<string> {
  const now = Date.now();

  if (cache && now - cache.timestamp < CACHE_TTL_MS) {
    return formatFaq(cache.data);
  }

  try {
    const res = await fetch(process.env.SHEET_CSV_URL!, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Sheet HTTP ${res.status}`);

    const csv = await res.text();
    const data = parseCsv(csv);
    cache = { data, timestamp: now };
    return formatFaq(data);
  } catch (err) {
    console.error('[sheet] fetch error:', err);

    if (cache) {
      console.warn('[sheet] falling back to stale cache');
      return formatFaq(cache.data);
    }

    return '(ไม่สามารถโหลดข้อมูล FAQ ได้)';
  }
}
