// lib/thai-date.ts — อ่านวันที่ที่แชมป์พิมพ์เป็นภาษาไทย/ตัวเลข → "YYYY-MM-DD" (ปฏิทินสากล เวลาไทย)
// รองรับ: วันนี้ / พรุ่งนี้ / มะรืน, 15/10, 15-10-2026, 15/10/26, 2026-10-15, 15 ต.ค., 15ตค26, 15 ตุลาคม 2569, "15" (วันที่ของเดือนนี้ ถ้าผ่านแล้วเดือนหน้า)

const MONTHS: Record<string, number> = {
  มค: 1, มกรา: 1, มกราคม: 1, กพ: 2, กุมภา: 2, กุมภาพันธ์: 2, มีค: 3, มีนา: 3, มีนาคม: 3,
  เมย: 4, เมษา: 4, เมษายน: 4, พค: 5, พฤษภา: 5, พฤษภาคม: 5, มิย: 6, มิถุนา: 6, มิถุนายน: 6,
  กค: 7, กรกฎา: 7, กรกฎาคม: 7, สค: 8, สิงหา: 8, สิงหาคม: 8, กย: 9, กันยา: 9, กันยายน: 9,
  ตค: 10, ตุลา: 10, ตุลาคม: 10, พย: 11, พฤศจิกา: 11, พฤศจิกายน: 11, ธค: 12, ธันวา: 12, ธันวาคม: 12,
};

export function bangkokToday(now = Date.now()): string {
  return new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function validYmd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const back = new Date(`${iso}T00:00:00Z`);
  return back.getUTCMonth() + 1 === m && back.getUTCDate() === d ? iso : null; // 31 ก.พ. = ไม่ผ่าน
}

function normYear(y: number): number {
  if (y >= 2400) return y - 543; // พ.ศ.
  if (y < 100) return 2000 + y;
  return y;
}

/** คืน YYYY-MM-DD หรือ null ถ้าอ่านไม่ออก */
export function parseThaiDate(input: string, today = bangkokToday()): string | null {
  const t = input.trim().replace(/\s+/g, ' ').replace(/[.,]/g, (c) => (c === '.' ? '' : ' ')).toLowerCase();
  if (!t) return null;
  if (/^วันนี้$/.test(t)) return today;
  if (/^พรุ่งนี้$/.test(t)) return addDaysYmd(today, 1);
  if (/^มะรืน(นี้)?$/.test(t)) return addDaysYmd(today, 2);

  const [ty, tm] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];

  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return validYmd(normYear(+m[1]), +m[2], +m[3]);

  m = t.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (m) return validYmd(m[3] ? normYear(+m[3]) : ty, +m[2], +m[1]);

  m = t.match(/^(\d{1,2}) ?([ก-๙]+) ?(\d{2,4})?$/);
  if (m) {
    const key = m[2].replace(/\s/g, '');
    const mon = MONTHS[key];
    if (mon) return validYmd(m[3] ? normYear(+m[3]) : ty, mon, +m[1]);
  }

  m = t.match(/^(\d{1,2})$/);
  if (m) {
    const day = +m[1];
    const thisMonth = validYmd(ty, tm, day);
    if (thisMonth && thisMonth >= today) return thisMonth;
    const next = tm === 12 ? validYmd(ty + 1, 1, day) : validYmd(ty, tm + 1, day);
    return next;
  }
  return null;
}

const WEEKDAY = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const MONTH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** "พุธ" ไม่ใช้ — ใช้ตัวย่อสั้นๆ ให้ปุ่มกระชับ เช่น "พ 15 ต.ค." */
export function dayLabel(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
}
