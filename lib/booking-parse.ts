// lib/booking-parse.ts — parses the structured description block `ctt-booking`
// (Claude Code skill, Agent 2) writes onto every booking Calendar event:
//   Guest: ...\nFrom: ...\nTo: ...\nPax: ...\nContact: ...\nBoat/Flight time: ...\nBooking No: ...
// Read-only parsing here — this file must never be the thing that WRITES that format,
// `ctt-booking` owns it.

export interface ParsedBooking {
  guest: string;
  from: string;
  to: string;
  pax: string;
  contact: string;
  pickupTime: string;
  bookingNo: string;
  flightNo: string; // บรรทัด "Flight No:" (บอท LINE เพิ่มเมื่อรับจากสนามบิน; ว่างถ้าไม่มี)
}

function extract(description: string, label: string): string {
  const m = description.match(new RegExp(`${label}:\\s*(.+)`));
  return m ? m[1].trim() : '';
}

export function parseBookingDescription(description: string): ParsedBooking {
  const parsed: ParsedBooking = {
    guest: extract(description, 'Guest'),
    from: extract(description, 'From'),
    to: extract(description, 'To'),
    pax: extract(description, 'Pax'),
    contact: extract(description, 'Contact'),
    pickupTime: extract(description, 'Boat/Flight time') || extract(description, 'Arrive'),
    bookingNo: extract(description, 'Booking No'),
    flightNo: extract(description, 'Flight No'),
  };

  // งานที่บอท LINE สร้างเองแบบเดิม (Apps Script handleLegacyCreate_) เขียน description เป็น
  //   📅 วันที่: 07/10/2026 เวลา 10:00 น. / 📍 รับที่: ... / 📍 ส่งที่: ... / 👥 จำนวน: 2 คน
  // ไม่มีป้าย Guest:/From:/To: — เติมจากป้ายแบบเดิมเท่าที่ยังว่าง ไม่ทับค่าที่อ่านได้แล้ว
  if (description.includes('LINE Bot')) {
    parsed.from ||= extract(description, '📍 รับที่');
    parsed.to ||= extract(description, '📍 ส่งที่');
    parsed.pax ||= extract(description, '👥 จำนวน');
    parsed.pickupTime ||= description.match(/เวลา\s*(\d{1,2}:\d{2})/)?.[1] ?? '';
    parsed.guest ||= 'ลูกค้าจอง LINE';
  }
  return parsed;
}
