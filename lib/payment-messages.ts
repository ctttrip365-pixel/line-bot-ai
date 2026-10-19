// lib/payment-messages.ts — ข้อความยืนยันถึงลูกค้าใน LINE หลังชำระเงินสำเร็จ (ภาษาของลูกค้า)
//
// แชมป์สั่ง 20 ต.ค. 2026: ต้องมีชื่อลูกค้าเพื่อเขียนป้ายรับ และบอกลูกค้าหลังจ่ายเงินว่า
// "คนขับจะเขียนชื่อลงป้ายและยืนถือป้ายรอที่ประตูทาง 15" (เฉพาะรับจากสนามบินกระบี่)

import type { BookingDetails } from './calendar';

export type MsgLang = 'thai' | 'english' | 'other';

/** รับจากสนามบินกระบี่ → มีจุดนัดรับประตูทาง 15 */
export function isKrabiAirportPickup(pickup: string): boolean {
  return /สนามบินกระบี่|krabi\s*airport|KBV/i.test(pickup);
}

export function customerPaidText(b: BookingDetails, lang: MsgLang = 'thai'): string {
  const name = (b.guestName ?? '').trim();
  const amount = Number(b.amount).toLocaleString('en-US');
  const gate = isKrabiAirportPickup(b.pickup);

  if (lang === 'thai') {
    return [
      '✅ รับเงินเรียบร้อยแล้วครับ!',
      '',
      `📅 ${b.date} เวลา ${b.time} น.`,
      `📍 ${b.pickup} → ${b.dropoff}`,
      `👥 ${b.pax} คน`,
      ...(name ? [`👤 ชื่อผู้โดยสาร: ${name}`] : []),
      `💰 ${amount} บาท`,
      ...(b.flight ? [`✈️ เที่ยวบิน: ${b.flight}`] : []),
      ...(gate
        ? [
            '',
            '📍 จุดนัดรับ: ประตูทาง 15 สนามบินกระบี่',
            name
              ? `🪧 คนขับจะเขียนชื่อ "${name}" ลงป้าย และยืนถือป้ายชื่อรอท่านที่ประตูทาง 15 ออกมาแล้วมองหาป้ายชื่อของท่านได้เลยครับ`
              : '🪧 คนขับจะเขียนชื่อท่านลงป้าย และยืนถือป้ายชื่อรอท่านที่ประตูทาง 15 ออกมาแล้วมองหาป้ายชื่อของท่านได้เลยครับ',
          ]
        : []),
      '',
      'พี่แชมป์จะรับท่านตรงเวลานะครับ 🚐',
      'หากต้องการเปลี่ยนแปลง LINE มาได้เลยครับ',
    ].join('\n');
  }

  return [
    '✅ Payment received — thank you!',
    '',
    `📅 ${b.date} at ${b.time}`,
    `📍 ${b.pickup} → ${b.dropoff}`,
    `👥 ${b.pax} passenger${b.pax === '1' ? '' : 's'}`,
    ...(name ? [`👤 Passenger name: ${name}`] : []),
    `💰 ${amount} THB`,
    ...(b.flight ? [`✈️ Flight: ${b.flight}`] : []),
    ...(gate
      ? [
          '',
          '📍 Meeting point: Gate 15, Krabi Airport',
          name
            ? `🪧 Your driver will write "${name}" on a name board and wait for you at Gate 15 holding the sign. After you exit, just look for the board with your name.`
            : '🪧 Your driver will write your name on a name board and wait for you at Gate 15 holding the sign. After you exit, just look for the board with your name.',
        ]
      : []),
    '',
    'Champ will pick you up on time 🚐',
    'If you need to change anything, just message us here.',
  ].join('\n');
}
