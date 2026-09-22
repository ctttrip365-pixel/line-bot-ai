// lib/date-range.ts — rolling date window (วันนี้ → วันสุดท้ายของเดือนหน้า) ที่ตัวเลือก
// วันว่าง/ขอลาของคนขับใช้ร่วมกัน แทนการตรึงไว้ที่ "วันที่ 1 เดือนหน้า" เหมือนเดิม
// (ปัญหาเดิม: เปิดดูวันไหนของเดือนก็เจอปฏิทินเดือนหน้าเต็มเดือน ทั้งที่ roster เดือนนี้ยังไม่ปิด)
// ขยับไปเรื่อยๆ ตามวันที่เรียกจริง ไม่ต้องรีบ deploy ใหม่ทุกเดือน

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** วันนี้ถึงวันสุดท้ายของเดือนหน้า เป็นรายวัน (ปกติยาว ~40-70 วัน แล้วแต่วันที่ปัจจุบัน) */
export function rollingDateRange(): string[] {
  const today = new Date();
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const endOfNextMonth = new Date(today.getFullYear(), today.getMonth() + 2, 0); // day 0 ของเดือน+2 = วันสุดท้ายของเดือน+1
  const dates: string[] = [];
  while (cursor <= endOfNextMonth) {
    dates.push(toIsoDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

/** เดือนปฏิทิน (YYYY-MM) ทั้งหมดที่ rolling window แตะ — ปกติ 2 เดือน (เดือนนี้ + เดือนหน้า) ใช้ดึง day-status cache */
export function monthsInRollingRange(): string[] {
  return Array.from(new Set(rollingDateRange().map((d) => d.slice(0, 7))));
}
