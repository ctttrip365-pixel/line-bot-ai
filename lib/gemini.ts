// lib/gemini.ts — Gemini wrapper with conversation history support
// history ถูกโลดจาก Redis และส่งมาที่นี่ เพื่อให้ Gemini จำบทสนทนาได้

import { GoogleGenAI, Type } from '@google/genai';
import type { Content } from '@google/genai';
import { lookupPrice, priceMenu } from './prices';
import { searchFaq, faqCategories } from './faq';
import { log } from './log';
import { buildSystemPrompt } from './prompts';
import { detectLanguage, languageRuleFor, extractReply } from './language';
import type { ChatMessage } from './history';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const MODEL = 'gemini-2.5-flash';

export const DEFAULT_REPLY_EN =
  'Sorry, let me check that for you — one moment please 🙏 Or you can contact Champ directly at +66 94 269 4651.';

export const DEFAULT_REPLY =
  'ขออภัยนะครับ ขอเวลาเช็คให้สักครู่ได้เลยครับ 🙏 หรือโทรหาพี่แชมป์ได้เลยครับที่ +66 94 269 4651';

/**
 * เรียก Gemini โดยลองใหม่ 1 ครั้งถ้าตอบ "ว่างเปล่า" (ไม่มีทั้งข้อความและการเรียก tool)
 * — เกิดจริงบน production 2026-10-07 15:49 (finishReason=STOP แต่ candidatesTokenCount=0, prompt ~19k โทเค็นเพราะ FAQ ยาว)
 * temperature 0.6 (เดิม 1.0) ให้ตอบนิ่งขึ้น เพราะเป็นบอทขาย/บอกราคา
 */
async function callModel(
  ai: GoogleGenAI,
  contents: Content[],
  systemPrompt: string,
  tools: unknown
): Promise<Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>> {
  const MAX_ATTEMPTS = 2;
  let response: Awaited<ReturnType<GoogleGenAI['models']['generateContent']>> | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    response = await ai.models.generateContent({
      model: MODEL,
      contents,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.6,
        // โทเค็น "คิด" นับรวมในโควตาเอาต์พุต: เคยใช้ไป 980 จาก 1,024 เหลือเขียนคำตอบ 40 → MAX_TOKENS (ทดสอบ 2026-10-07)
        // จำกัดงบคิดไว้ 256 และขยายเพดานเป็น 2048
        thinkingConfig: { thinkingBudget: 256 },
        maxOutputTokens: 2048,
        tools: tools as any,
      },
    });
    const hasOutput = (response.functionCalls?.length ?? 0) > 0 || !!response.text?.trim();
    if (hasOutput) return response;
    log.warn('gemini.empty_response_retry', {
      attempt,
      finishReason: response.candidates?.[0]?.finishReason,
      totalTokens: response.usageMetadata?.totalTokenCount,
    });
  }
  return response!;
}

/**
 * หมายเหตุ: พารามิเตอร์ที่ 2 (_faqText) เลิกใช้แล้ว — FAQ ถูกค้นผ่าน tool search_faq (lib/faq.ts) แทนการยัดทั้งชีตใน prompt
 * คงไว้เพื่อให้ผู้เรียกเดิม (route, scripts/chat-test.mts) ไม่ต้องแก้
 */
export async function generateReply(
  userMessage: string,
  _faqText: string,
  history: ChatMessage[] = []
): Promise<string> {
  const startTime = Date.now();
  // ส่ง isFirstMessage เพื่อให้บอทไม่ทักสวัสดีซ้ำในบทสนทนาต่อเนื่อง
  const isFirstMessage = history.length === 0;
  // ภาษาตอบกำหนดจากโค้ด (ดูตัวอักษรในข้อความลูกค้า) ไม่ให้ Gemini เดา
  const lang = detectLanguage(userMessage, history);
  const fallbackReply = lang === 'thai' ? DEFAULT_REPLY : DEFAULT_REPLY_EN;
  // รายชื่อหมวด FAQ (cache 60 วิ) ไว้ให้ Gemini เลือกหมวดตอนเรียก search_faq — โหลดไม่ได้ก็ไม่ล้ม (tool จะรายงาน error เอง)
  let categories = '';
  try {
    categories = (await faqCategories()).join(' | ');
  } catch (err) {
    log.warn('faq.categories_unavailable', { err: (err as Error).message });
  }
  // ค้น FAQ ล่วงหน้าจากข้อความลูกค้าทุกครั้ง แล้วแนบแถวที่เจอใน prompt — ไม่พึ่งให้ Gemini ตัดสินใจเรียก search_faq เอง
  // (ทดสอบจริงพบว่าบางครั้งข้ามไปเลยแล้วตอบ "ช่วยไม่ได้" ทั้งที่มีคำตอบใน FAQ) ถ้าค้นไม่ได้/ไม่เจอ ก็ไม่แนบ ไม่กระทบการตอบ
  let faqCandidates = '';
  try {
    const pre = await searchFaq(userMessage);
    if (pre.status === 'ok' || pre.status === 'weak') {
      faqCandidates = [
        `<faq_candidates status="${pre.status}">`,
        ...pre.results.map((r, i) => `[${i + 1}] หมวด: ${r.category}\nQ: ${r.question}\nA: ${r.answer}`),
        `คำแนะนำ: ${pre.message}`,
        '</faq_candidates>',
      ].join('\n');
    }
  } catch (err) {
    log.warn('faq.prefetch_failed', { err: (err as Error).message });
  }
  const systemPrompt = buildSystemPrompt(categories, fallbackReply, isFirstMessage, languageRuleFor(lang), faqCandidates);

  // Build contents array: history turns + current user message
  const contents: Content[] = [
    ...history.map((msg) => ({
      role: msg.role as 'user' | 'model',
      parts: [{ text: msg.text }],
    })),
    { role: 'user' as const, parts: [{ text: userMessage }] },
  ];

  // ราคาต้องมาจาก lookup_price (ค้นจาก Google Sheet) เท่านั้น — Gemini ไม่คิดเลขเอง
  const tools = [
    {
      functionDeclarations: [
        {
          name: 'lookup_price',
          description:
            'ค้นราคารถตู้ CTT ต่อ 1 คัน จากตารางราคาจริง ใช้ทุกครั้งก่อนบอกราคาลูกค้า คืน status: ok (มี price) / ambiguous / not_found / handoff',
          parameters: {
            type: Type.OBJECT,
            properties: {
              origin: { type: Type.STRING, description: 'จุดรับ ตามที่ลูกค้าพิมพ์ เช่น สนามบินกระบี่, Avani Krabi' },
              destination: { type: Type.STRING, description: 'จุดส่ง ตามที่ลูกค้าพิมพ์ เช่น ป่าตอง, สนามบินภูเก็ต' },
              pax: { type: Type.INTEGER, description: 'จำนวนผู้โดยสาร' },
            },
            required: ['origin', 'destination', 'pax'],
          },
        },
        {
          name: 'list_prices_from',
          description:
            'รู้จุดรับแล้ว แต่ยังไม่รู้จุดส่ง (หรือจุดส่งไม่ชัด/ไม่มีราคา) → เรียกตัวนี้ ระบบจะแนบตารางราคาทุกปลายทางจากจุดรับนั้นให้ลูกค้าเอง พร้อมคำถามปลายทางและข้อเสนอทัวร์วันเดย์',
          parameters: {
            type: Type.OBJECT,
            properties: {
              origin: { type: Type.STRING, description: 'จุดรับ ตามที่ลูกค้าพิมพ์ เช่น สนามบินกระบี่, Avani Krabi (แปลเป็นไทย/อังกฤษก่อนถ้าเป็นภาษาอื่น)' },
              pax: { type: Type.INTEGER, description: 'จำนวนผู้โดยสาร ถ้ารู้แล้ว (ไม่ระบุถ้ายังไม่รู้)' },
            },
            required: ['origin'],
          },
        },
        {
          name: 'search_faq',
          description:
            'ค้นข้อมูลทั่วไปของ CTT (บริการ นโยบาย ทัวร์ ความปลอดภัย การติดต่อ ข้อมูลกระบี่ ฯลฯ) จาก FAQ จริง คืน status: ok / weak / not_found / error พร้อมแถวที่ตรง ห้ามใช้ค้นราคารถรับส่ง (ใช้ lookup_price)',
          parameters: {
            type: Type.OBJECT,
            properties: {
              query: { type: Type.STRING, description: 'คำถามของลูกค้า เป็นภาษาไทยหรืออังกฤษ (แปลก่อนถ้าเป็นภาษาอื่น)' },
              category: { type: Type.STRING, description: 'หมวด FAQ ที่เกี่ยวข้อง (ถ้ารู้) เลือกจากรายชื่อหมวดใน prompt' },
            },
            required: ['query'],
          },
        },
      ],
    },
  ];

  // ตารางราคาจากโค้ด (ไม่ผ่าน Gemini): ถ้ามี จะแนบต่อท้ายคำตอบเสมอ — Gemini เขียนแค่ประโยคนำสั้นๆ
  let menuText = '';
  const MENU_NOTE =
    'ข้อมูลสำหรับคุณเท่านั้น (ห้ามเอ่ยถึงลูกค้า): ตารางราคาถูกแนบให้ลูกค้าแล้ว — เขียนเฉพาะประโยคนำสั้นๆ 1 ประโยค เช่น "ราคารถรับ-ส่งจากสนามบินกระบี่ตามนี้ครับ" ห้ามพิมพ์ราคาหรือรายการเส้นทางเอง ห้ามถามปลายทาง/จำนวนคนซ้ำ ห้ามเสนอทัวร์เอง ห้ามพูดถึงระบบหรือตาราง';

  const MAX_TOOL_ROUNDS = 3;
  let response = await callModel(ai, contents, systemPrompt, tools);

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const calls = response.functionCalls;
    if (!calls || calls.length === 0) break;
    const modelContent = response.candidates?.[0]?.content;
    if (modelContent) contents.push(modelContent);

    const responseParts = await Promise.all(
      calls.map(async (call) => {
        let result: Record<string, unknown>;
        try {
          if (call.name === 'search_faq') {
            const a = (call.args ?? {}) as { query?: string; category?: string };
            result = { ...(await searchFaq(String(a.query ?? ''), a.category ? String(a.category) : undefined)) };
          } else if (call.name === 'list_prices_from') {
            const a = (call.args ?? {}) as { origin?: string; pax?: number | string };
            const paxN = a.pax !== undefined && a.pax !== null && String(a.pax) !== '' ? Number(a.pax) : undefined;
            const m = await priceMenu(String(a.origin ?? ''), lang, paxN);
            if (m.status === 'ok') {
              menuText = m.text;
              result = { status: 'menu_ready', origin_zone: m.originZone, destination_count: m.destinations.length, message: MENU_NOTE };
            } else {
              result = { status: 'not_found', message: 'ไม่รู้จักจุดรับนี้ ให้ถามลูกค้าว่าจุดรับอยู่ย่านไหน ถ้ายังไม่ทราบแจ้งว่าพี่แชมป์จะเช็คให้ และใส่ [HANDOFF]' };
            }
            log.info('gemini.price_menu', { status: m.status });
          } else if (call.name === 'lookup_price') {
            const args = (call.args ?? {}) as { origin?: string; destination?: string; pax?: number | string };
            result = { ...(await lookupPrice(String(args.origin ?? ''), String(args.destination ?? ''), Number(args.pax))) };
            log.info('gemini.price_lookup', { status: result.status });
            // รู้ต้นทางแต่จับปลายทางไม่ได้/กำกวม → ส่งตารางราคาทุกปลายทางจากต้นทางนั้นแทน (ลดปัญหาจับชื่อปลายทางไม่ตรง)
            if (result.status === 'not_found' || result.status === 'ambiguous') {
              const paxN = Number(args.pax);
              const m = await priceMenu(String(args.origin ?? ''), lang, Number.isFinite(paxN) ? paxN : undefined);
              if (m.status === 'ok') {
                menuText = m.text;
                result = { status: 'menu_ready', reason: result.status, origin_zone: m.originZone, destination_count: m.destinations.length, message: MENU_NOTE };
                log.info('gemini.price_menu', { status: 'fallback_from_lookup' });
              }
            }
          } else {
            throw new Error(`unknown tool ${call.name}`);
          }
        } catch (err) {
          log.error('gemini.price_lookup_failed', { err: (err as Error).message });
          // ค้นราคาไม่ได้ (Sheet ล่ม ฯลฯ) → ให้ส่งต่อแชมป์ ไม่ให้เดาราคา
          result = { status: 'handoff', reason: 'price_lookup_error', message: 'ค้นราคาไม่ได้ชั่วคราว ห้ามบอกราคา แจ้งว่าพี่แชมป์จะเช็คให้' };
        }
        return { functionResponse: { name: call.name, response: result } };
      })
    );
    contents.push({ role: 'user', parts: responseParts });

    response = await callModel(ai, contents, systemPrompt, tools);
  }

  const usage = response.usageMetadata;
  const finishReason = response.candidates?.[0]?.finishReason;

  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: 'gemini.reply',
      latencyMs: Date.now() - startTime,
      historyTurns: history.length / 2,
      isFirstMessage,
      inputLength: userMessage.length,
      outputLength: response.text?.length ?? 0,
      finishReason,
      thoughtsTokenCount: usage?.thoughtsTokenCount ?? 0,
      candidatesTokenCount: usage?.candidatesTokenCount ?? 0,
      totalTokenCount: usage?.totalTokenCount ?? 0,
    })
  );

  if (finishReason === 'MAX_TOKENS') {
    console.warn(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: 'gemini.truncated',
        thoughtsTokenCount: usage?.thoughtsTokenCount,
        candidatesTokenCount: usage?.candidatesTokenCount,
      })
    );
    throw new Error('gemini_max_tokens');
  }

  // ดึงเฉพาะข้อความใน <reply> (ทิ้ง "THINK ..." ที่หลุดมา) ถ้าโมเดลเขียนความคิดล้วนๆ → ใช้ข้อความ fallback
  const raw = response.text?.trim();
  if (!raw) {
    // Gemini เงียบหลังเรียก tool แต่ตารางราคาพร้อมแล้ว → ส่งตารางพร้อมประโยคนำสำเร็จรูป ไม่ทิ้งลูกค้า
    if (menuText) return `${lang === 'thai' ? 'ราคารถรับ-ส่งตามนี้ครับ' : 'Here are our transfer prices:'}\n\n${menuText}`;
    throw new Error('gemini_empty_response');
  }
  const reply = extractReply(raw);
  if (!reply) {
    log.warn('gemini.reply_unusable', { lang, startsWith: raw.slice(0, 20) });
    if (menuText) return `${lang === 'thai' ? 'ราคารถรับ-ส่งตามนี้ครับ' : 'Here are our transfer prices:'}\n\n${menuText}`;
    throw new Error('gemini_unusable_reply');
  }

  return menuText ? `${reply}\n\n${menuText}` : reply;
}
