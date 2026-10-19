// lib/bank.ts — ข้อมูลโอนบัญชี + ข้อความตอนสร้างลิงก์ชำระเงินล้มเหลว
//
// ข้อมูลบัญชีอยู่ใน env BANK_TRANSFER_INFO (ตั้งใน Vercel) — repo เป็น public ห้ามฝังเลขบัญชีในโค้ด
// Gemini "ไม่เห็น" ข้อมูลนี้อีกต่อไป: ให้พิมพ์ตัวบอก [BANK_INFO] แล้วโค้ดแทนด้วยค่าจริงตรงทุกตัวอักษร
// (เดิมให้ Gemini คัดลอกเอง ทำให้ชื่อบัญชีสะกดเพี้ยนไปทุกรอบ เจอจริง 10–14 ต.ค. 2026)

export const BANK_MARKER = '[BANK_INFO]';

export function bankInfoText(): string {
  return (process.env.BANK_TRANSFER_INFO ?? '').trim();
}

/** แทน [BANK_INFO] ด้วยข้อมูลจริงจาก env; ไม่ได้ตั้ง env = ตัดตัวบอกทิ้ง (prompt สั่งให้ส่งต่อแชมป์ในกรณีนี้อยู่แล้ว) */
export function applyBankInfo(reply: string): string {
  if (!reply.includes(BANK_MARKER)) return reply;
  const info = bankInfoText();
  return reply
    .split(BANK_MARKER)
    .join(info)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export type FailureLang = 'thai' | 'english' | 'other';

export interface LinkFailureInput {
  lang: FailureLang;
  amount?: number; // ยอดเต็มที่ลูกค้าต้องโอน (ราคาลูกค้า)
  err: string;
  booking?: { date: string; time: string; pickup: string; dropoff: string; pax: string; phone?: string; flight?: string };
  ref?: string;
  userId: string;
}

/** ข้อความถึงลูกค้าเมื่อสร้างลิงก์ไม่ได้: ภาษาของลูกค้า + ข้อมูลโอนจาก env + ขอสลิป (ไม่ปล่อยให้ลูกค้าถามต่อเอง) */
export function linkFailureCustomerText(lang: FailureLang, amount?: number): string {
  const info = bankInfoText();
  const amt = amount && amount > 0 ? amount.toLocaleString('en-US') : '';
  if (lang === 'thai') {
    return [
      '⚠️ ขออภัยครับ ระบบสร้างลิงก์ชำระเงินออนไลน์ขัดข้องชั่วคราว พี่แชมป์ได้รับแจ้งแล้วครับ',
      ...(info
        ? [
            '',
            'ระหว่างนี้โอนเข้าบัญชีได้เลยครับ:',
            info,
            ...(amt ? [`ยอดที่ต้องโอน: ${amt} บาท`] : []),
            '',
            'โอนแล้วส่งรูปสลิปมาในแชทนี้ พี่แชมป์จะตรวจสอบและยืนยันการจองให้ครับ 🙏',
          ]
        : ['', 'พี่แชมป์จะติดต่อกลับพร้อมวิธีชำระเงินให้ครับ 🙏']),
      'หรือโทร +66 94 269 4651 ครับ',
    ].join('\n');
  }
  return [
    '⚠️ Sorry, our online payment link is temporarily unavailable. Champ has been notified.',
    ...(info
      ? [
          '',
          'In the meantime you can pay by bank transfer:',
          info,
          ...(amt ? [`Amount to transfer: ${amt} THB`] : []),
          '',
          'After transferring, please send a photo of the transfer slip in this chat and Champ will verify and confirm your booking 🙏',
        ]
      : ['', 'Champ will contact you shortly with payment details 🙏']),
    'Or call +66 94 269 4651.',
  ].join('\n');
}

/** ข้อความแจ้งแชมป์ (Telegram, HTML) เมื่อสร้างลิงก์ล้ม — ลูกค้ากำลังรออยู่ */
export function linkFailureAdminText(i: LinkFailureInput): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const b = i.booking;
  return [
    '<b>⚠️ สร้างลิงก์ชำระเงินไม่สำเร็จ — ลูกค้ากำลังรอ</b>',
    '',
    ...(b
      ? [
          `📅 ${esc(b.date)} เวลา ${esc(b.time)} น.`,
          `📍 ${esc(b.pickup)} → ${esc(b.dropoff)}`,
          `👥 ${esc(b.pax)} คน${i.amount ? ` | 💰 ${i.amount.toLocaleString('en-US')} บาท` : ''}`,
          ...(b.phone ? [`📞 ${esc(b.phone)}`] : []),
          ...(b.flight ? [`✈️ ${esc(b.flight)}`] : []),
        ]
      : []),
    ...(i.ref ? [`🔖 รหัส: ${esc(i.ref)}`] : []),
    `LINE userId: <code>${esc(i.userId)}</code>`,
    `สาเหตุ: ${esc(i.err.slice(0, 300))}`,
    '',
    'ลูกค้าได้รับข้อมูลโอนบัญชีแล้ว (ถ้าตั้ง BANK_TRANSFER_INFO) — รอสลิป แล้วตรวจและลงงานเอง หรือส่งลิงก์ให้ลูกค้าด้วยมือ',
  ].join('\n');
}
