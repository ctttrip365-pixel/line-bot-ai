// lib/flex-driver.ts — LINE message builders for driver-facing flows.
// Deliberately NOT Gemini/free-text — every driver interaction is a tap on a
// button (postback), never open-ended chat, so the sales-bot accuracy problem
// documented elsewhere in this repo doesn't apply here at all.

import { FlexBubble, FlexMessage, Message } from '@line/bot-sdk';
import { DayStatus } from './day-status';

const THAI_WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const THAI_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

function dayLabel(date: string, status?: DayStatus): string {
  // "1 พฤ" หรือ "1 พฤ · ไม่มีงาน" ถ้ามีข้อมูลสถานะ booking ของวันนั้น
  const [y, m, d] = date.split('-').map(Number);
  const weekday = THAI_WEEKDAYS[new Date(y, m - 1, d).getDay()];
  const base = `${d} ${weekday}`;
  return status ? `${base} · ${status}` : base;
}

/** ป้ายหัว bubble รายสัปดาห์ เช่น "29 ก.ย. – 5 ต.ค." (คร่อมเดือนได้ เพราะ dates เป็น rolling window) */
function weekRangeLabel(week: string[]): string {
  const [fy, fm, fd] = week[0].split('-').map(Number);
  const [, lm, ld] = week[week.length - 1].split('-').map(Number);
  const first = `${fd} ${THAI_MONTHS[fm - 1]}`;
  const last = fm === lm ? `${ld}` : `${ld} ${THAI_MONTHS[lm - 1]}`;
  return `${first} – ${last} ${fy}`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * carousel ของปุ่มเลือกวัน — 1 bubble ต่อสัปดาห์ (~7 วัน/bubble)
 * `dates` คือ rolling window "วันนี้ → สิ้นเดือนหน้า" (ดู lib/date-range.ts) คร่อมได้ 2 เดือนปฏิทิน
 * postback data: "avail:pick:{date}" ต่อวันที่ถูกกด, ปุ่มสุดท้ายรวม "avail:submit"
 * (แต่ละวันคงเดือนของตัวเองอยู่ในตัว YYYY-MM-DD อยู่แล้ว ไม่ต้องแนบเดือนแยกอีก — ดู handleDriverPostback ที่จัดกลุ่มตามเดือนตอนบันทึก)
 * เลือกได้หลายวัน (bot toggle สถานะไว้ใน Redis จนกว่าจะกด submit — ดู app/api/line-webhook)
 */
export function buildAvailabilityCarousel(
  dates: string[],
  selectedDates: string[],
  dayStatus?: Record<string, DayStatus>
): FlexMessage {
  const weeks = chunk(dates, 7);
  const selected = new Set(selectedDates);

  const bubbles: FlexBubble[] = weeks.map((week) => ({
    type: 'bubble',
    size: 'micro',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: weekRangeLabel(week), weight: 'bold', size: 'sm', wrap: true },
        ...week.map((date) => ({
          type: 'button' as const,
          style: (selected.has(date) ? 'primary' : 'secondary') as 'primary' | 'secondary',
          height: 'sm' as const,
          action: {
            type: 'postback' as const,
            label: dayLabel(date, dayStatus?.[date]),
            data: `avail:pick:${date}`,
            displayText: `เลือกวันที่ ${dayLabel(date)} (${date})`,
          },
        })),
      ],
    },
  }));

  // bubble สุดท้าย: ปุ่มส่ง — ไม่ใส่ตัวเลขจำนวนวันที่เลือกไว้ตรงนี้ เพราะการ์ดที่ส่งไปแล้ว
  // แก้ไขให้อัปเดตสดไม่ได้ (ข้อจำกัดของ LINE) — จำนวนจริงจะอยู่ในข้อความตอบกลับทุกครั้งที่กดเลือกวันแทน
  bubbles.push({
    type: 'bubble',
    size: 'micro',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: 'เลือกวันครบแล้วกดส่งได้เลย', size: 'sm', wrap: true },
        {
          type: 'button',
          style: 'primary',
          color: '#1DB446',
          action: {
            type: 'postback',
            label: '✅ ส่งวันว่าง',
            data: 'avail:submit',
            displayText: 'ส่งวันว่างเรียบร้อย',
          },
        },
      ],
    },
  });

  return {
    type: 'flex',
    altText: 'เลือกวันว่างขับ',
    contents: { type: 'carousel', contents: bubbles },
  };
}

export function buildLeaveDatePicker(dates: string[], dayStatus?: Record<string, DayStatus>): FlexMessage {
  // ใช้โครงเดียวกับ availability แต่ postback prefix ต่างกัน (leave:pick / leave:submit)
  const weeks = chunk(dates, 7);
  const bubbles: FlexBubble[] = weeks.map((week) => ({
    type: 'bubble',
    size: 'micro',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: weekRangeLabel(week), weight: 'bold', size: 'sm', wrap: true },
        ...week.map((date) => ({
          type: 'button' as const,
          style: 'secondary' as const,
          height: 'sm' as const,
          action: {
            type: 'postback' as const,
            label: dayLabel(date, dayStatus?.[date]),
            data: `leave:pick:${date}`,
            displayText: `ขอลาวันที่ ${dayLabel(date)} (${date})`,
          },
        })),
      ],
    },
  }));
  return {
    type: 'flex',
    altText: 'เลือกวันที่ต้องการลา/เปลี่ยน',
    contents: { type: 'carousel', contents: bubbles },
  };
}

export function buildJobNoticeText(job: {
  guest: string;
  from: string;
  to: string;
  pax: string;
  contact: string;
  pickupTime: string;
  bookingNo: string;
}): Message {
  const text = [
    '📋 งานพรุ่งนี้',
    `Guest: ${job.guest}`,
    `From: ${job.from}`,
    `To: ${job.to}`,
    `Pax: ${job.pax}`,
    `Contact: ${job.contact}`,
    `เวลารับ: ${job.pickupTime}`,
    `Booking No: ${job.bookingNo}`,
    '',
    'มีปัญหาติดต่อแชมป์ได้เลยครับ 🙏',
  ].join('\n');
  return { type: 'text', text };
}
