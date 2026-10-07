// lib/language.ts — กำหนดภาษาที่บอทต้องตอบจาก "ตัวอักษรในข้อความลูกค้า" ด้วยโค้ด
// (เดิมปล่อยให้ Gemini เดาเอง ทำให้ลูกค้าพิมพ์อังกฤษแต่ได้คำตอบไทยเพราะประวัติแชท/เทมเพลตเป็นไทย)
// และกัน "THINK ..." ที่โมเดลเขียนความคิดหลุดมาในคำตอบ ด้วยการให้ห่อคำตอบใน <reply> แล้วดึงเฉพาะข้างใน

import type { ChatMessage } from './history';

const THAI = /[฀-๿]/;
const LATIN = /[A-Za-z]/;
const OTHER_LETTER = /[֐-ۿऀ-ॿ぀-ヿ㐀-鿿가-힯Ѐ-ӿ]/; // ฮีบรู/อาหรับ/เทวนาครี/ญี่ปุ่น/จีน/เกาหลี/ซีริลลิก

type Lang = 'thai' | 'english' | 'other';

function classify(text: string): Lang | null {
  if (THAI.test(text)) return 'thai';
  if (OTHER_LETTER.test(text)) return 'other';
  if (LATIN.test(text)) return 'english';
  return null; // มีแต่ตัวเลข/อีโมจิ เช่น "👍" "2"
}

/** ภาษาของข้อความล่าสุดที่มีตัวอักษร (ข้อความปัจจุบันก่อน ถ้าไม่มีดูย้อนหลังในประวัติ) */
export function detectLanguage(userMessage: string, history: ChatMessage[] = []): Lang {
  const now = classify(userMessage);
  if (now) return now;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== 'user') continue;
    const l = classify(history[i].text);
    if (l) return l;
  }
  return 'thai';
}

export function languageRuleFor(lang: Lang): string {
  switch (lang) {
    case 'thai':
      return 'ลูกค้าพิมพ์ภาษาไทย → ตอบเป็นภาษาไทยเท่านั้น';
    case 'english':
      return 'The customer wrote in English → reply ONLY in English. Do not use Thai (except proper names). ตอบเป็นภาษาอังกฤษเท่านั้น';
    default:
      return 'ลูกค้าพิมพ์ภาษาอื่นที่ไม่ใช่ไทย/อังกฤษ → ตอบด้วยภาษาเดียวกับข้อความล่าสุดของลูกค้า (ถ้าไม่แน่ใจให้ตอบภาษาอังกฤษ) ห้ามตอบเป็นภาษาไทย';
  }
}

/** ล้างแท็กที่โมเดลหลุดใส่มา: <reply> ตกค้าง และ HTML (<p> <br/> ฯลฯ) ซึ่งใน LINE จะโชว์เป็นตัวอักษรจริง */
export function cleanReplyText(s: string): string {
  return s
    .replace(/<\/?reply>/gi, '')
    // กันข้อความอธิบายการทำงานภายในหลุดถึงลูกค้า เช่น "(ระบบจะแสดงตารางราคาให้ลูกค้าเอง)" "(the system will attach ...)"
    .replace(/[(（][^()（）]{0,80}(ระบบจะ|ระบบแนบ|the system will|system will attach)[^()（）]{0,120}[)）]/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<\/?(p|strong|b|em|i|u|ul|ol|li|div|span)(\s[^>]*)?>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const MARKERS = [/\[BOOKING_CONFIRMED\][\s\S]*?\[\/BOOKING_CONFIRMED\]/, /\[HANDOFF\]/];

/**
 * ดึงเฉพาะข้อความใน <reply>...</reply> ทิ้งส่วนที่โมเดลเขียนนอกแท็ก (เช่น "THINK ..." ที่หลุดมา)
 * - มี marker ระบบ ([BOOKING_CONFIRMED]/[HANDOFF]) อยู่นอกแท็ก → ต่อท้ายให้ (ระบบต้องอ่านเจอ)
 * - ไม่มีแท็กเลย: ถ้าขึ้นต้นด้วย THINK = ความคิดหลุด → คืน null (ผู้เรียกใช้ข้อความ fallback) ไม่งั้นใช้ทั้งข้อความ
 */
export function extractReply(raw: string): string | null {
  const text = raw.trim();
  const closed = text.match(/<reply>([\s\S]*?)<\/reply>/i);
  const open = text.match(/<reply>([\s\S]*)$/i); // ถูกตัดกลางทาง ไม่มีแท็กปิด
  const inner = closed?.[1] ?? open?.[1];

  if (inner !== undefined) {
    let reply = inner.trim();
    for (const m of MARKERS) {
      const found = text.match(m);
      if (found && !m.test(reply)) reply += `\n${found[0]}`;
    }
    return cleanReplyText(reply) || null;
  }

  if (/^\s*THINK\b/i.test(text)) return null;
  return cleanReplyText(text) || null;
}
