// lib/flex-driver.ts — LINE message builders for driver-facing flows.
// Deliberately NOT Gemini/free-text — every driver interaction is a tap on a
// button (postback), never open-ended chat, so the sales-bot accuracy problem
// documented elsewhere in this repo doesn't apply here at all.

import { FlexBubble, FlexMessage, Message } from '@line/bot-sdk';

function daysInMonth(month: string): string[] {
  // month: "YYYY-MM"
  const [y, m] = month.split('-').map(Number);
  const count = new Date(y, m, 0).getDate();
  return Array.from({ length: count }, (_, i) => {
    const d = String(i + 1).padStart(2, '0');
    return `${month}-${d}`;
  });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * carousel ของปุ่มเลือกวัน — 1 bubble ต่อสัปดาห์ (~7 วัน/bubble)
 * postback data: "avail:pick:{month}:{date}" ต่อวันที่ถูกกด, ปุ่มสุดท้ายรวม "avail:submit:{month}"
 * เลือกได้หลายวัน (bot toggle สถานะไว้ใน Redis จนกว่าจะกด submit — ดู app/api/line-webhook)
 */
export function buildAvailabilityCarousel(month: string, selectedDates: string[]): FlexMessage {
  const weeks = chunk(daysInMonth(month), 7);
  const selected = new Set(selectedDates);

  const bubbles: FlexBubble[] = weeks.map((week, i) => ({
    type: 'bubble',
    size: 'micro',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: `สัปดาห์ที่ ${i + 1}`, weight: 'bold', size: 'sm' },
        ...week.map((date) => ({
          type: 'button' as const,
          style: (selected.has(date) ? 'primary' : 'secondary') as 'primary' | 'secondary',
          height: 'sm' as const,
          action: {
            type: 'postback' as const,
            label: date.slice(-2), // แค่วันที่ (dd)
            data: `avail:pick:${month}:${date}`,
            displayText: `เลือกวันที่ ${date}`,
          },
        })),
      ],
    },
  }));

  // bubble สุดท้าย: ปุ่มส่ง
  bubbles.push({
    type: 'bubble',
    size: 'micro',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: `เลือกแล้ว ${selectedDates.length} วัน`, size: 'sm', wrap: true },
        {
          type: 'button',
          style: 'primary',
          color: '#1DB446',
          action: {
            type: 'postback',
            label: '✅ ส่งวันว่างเดือนนี้',
            data: `avail:submit:${month}`,
            displayText: 'ส่งวันว่างเรียบร้อย',
          },
        },
      ],
    },
  });

  return {
    type: 'flex',
    altText: `เลือกวันว่างขับเดือน ${month}`,
    contents: { type: 'carousel', contents: bubbles },
  };
}

export function buildLeaveDatePicker(month: string): FlexMessage {
  // ใช้โครงเดียวกับ availability แต่ postback prefix ต่างกัน (leave:pick / leave:submit)
  const weeks = chunk(daysInMonth(month), 7);
  const bubbles: FlexBubble[] = weeks.map((week, i) => ({
    type: 'bubble',
    size: 'micro',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: `สัปดาห์ที่ ${i + 1}`, weight: 'bold', size: 'sm' },
        ...week.map((date) => ({
          type: 'button' as const,
          style: 'secondary' as const,
          height: 'sm' as const,
          action: {
            type: 'postback' as const,
            label: date.slice(-2),
            data: `leave:pick:${date}`,
            displayText: `ขอลาวันที่ ${date}`,
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
