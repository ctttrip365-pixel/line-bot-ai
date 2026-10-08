// lib/gemini.ts — Gemini wrapper with conversation history support
// history ถูกโลดจาก Redis และส่งมาที่นี่ เพื่อให้ Gemini จำบทสนทนาได้

import { GoogleGenAI, Type, FunctionCallingConfigMode } from '@google/genai';
import type { Content } from '@google/genai';
import { lookupPrice, priceMenu, offersAlreadyMade, tourOfferText, zonesInText, zoneLabelTh } from './prices';
import type { PriceLookupResult } from './prices';
import { recordPlaceZone } from './place-zones';
import { norm } from './text-norm';
import { searchFaq, faqCategories } from './faq';
import { log } from './log';
import { buildSystemPrompt } from './prompts';
import { detectLanguage, languageRuleFor, extractReply } from './language';
import type { ChatMessage } from './history';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const MODEL = 'gemini-2.5-flash';

// ลูกค้าพิมพ์ถามราคาไหม (ไทย/อังกฤษ/ฮีบรู/จีน) — ใช้ตัดสินว่าจะบอกราคาก่อนเก็บวัน/เวลาได้หรือเปล่า
function customerAskedPrice(userTexts: string[]): boolean {
  return userTexts.some((t) => /ราคา|เท่าไหร่|เท่าไร|กี่บาท|ค่ารถ|ค่าบริการ|ค่าโดยสาร|price|how much|cost|fare|rate|quote|כמה|מחיר|多少|价格|价钱|费用|金额/i.test(t));
}

/**
 * ถ้า lookup_price สำเร็จโดยใช้ "ชื่อย่าน" แทนสถานที่ที่ระบบไม่รู้จัก → บันทึก สถานที่ → ย่าน (lib/place-zones.ts)
 * รู้ชื่อสถานที่จาก (1) พารามิเตอร์ place_name หรือ (2) รูปแบบ "โรงแรมXYZ (อ่าวนาง)" ในช่อง origin/destination
 * source = customer ถ้าลูกค้าเป็นคนพูดถึงย่านนั้นเอง ไม่งั้น gemini (เดาจากความรู้ของโมเดล) — แชมป์เห็นป้ายต่างกันในสรุป 09:00
 */
async function learnPlace(
  args: { origin?: string; destination?: string; place_name?: string; place_role?: string },
  lp: PriceLookupResult,
  userTexts: string[]
): Promise<void> {
  if (lp.status !== 'ok') return;
  const cands: Array<{ name: string; areaText: string; zone: string }> = [];
  const placeName = String(args.place_name ?? '').trim();
  if (placeName) {
    const role = args.place_role === 'origin' ? 'origin' : 'destination';
    cands.push({ name: placeName, areaText: String(args[role] ?? ''), zone: role === 'origin' ? lp.from : lp.to });
  }
  for (const role of ['origin', 'destination'] as const) {
    const m = String(args[role] ?? '').match(/^(.+?)\s*[（(]\s*(.+?)\s*[)）]\s*$/);
    if (m) cands.push({ name: m[1], areaText: m[2], zone: role === 'origin' ? lp.from : lp.to });
  }
  const seen = new Set<string>();
  for (const c of cands) {
    const key = norm(c.name);
    if (!key || seen.has(key) || key === norm(c.areaText)) continue;
    seen.add(key);
    if ((await zonesInText(c.name)).length > 0) continue; // ระบบรู้จักสถานที่นี้อยู่แล้ว (ชีต/alias) ไม่ต้องจำ
    let customerSaid = false;
    for (const t of userTexts) {
      const nt = norm(t);
      if (nt.includes(norm(c.areaText)) || nt.includes(norm(c.zone)) || nt.includes(norm(zoneLabelTh(c.zone))) || (await zonesInText(t)).includes(c.zone)) {
        customerSaid = true;
        break;
      }
    }
    await recordPlaceZone(c.name, c.zone, customerSaid ? 'customer' : 'gemini');
  }
}

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
  tools: unknown,
  forcePriceTool = false
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
        // บังคับเรียก tool ราคา (ใช้เมื่อ Gemini ข้าม tool ทั้งที่ลูกค้าถามราคา) — ดูตรรกะใน generateReply
        ...(forcePriceTool
          ? { toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: ['lookup_price', 'list_prices_from'] } } }
          : {}),
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
  // ขึ้นขายครั้งเดียวต่อบทสนทนา: ตารางราคา/ข้อเสนอทัวร์ที่ส่งไปแล้วในประวัติ ห้ามส่งซ้ำ (แชมป์สั่ง 8 ต.ค. 2026)
  const already = offersAlreadyMade(history);
  // ลูกค้า "ถามราคา" แล้วหรือยัง (ทั้งบทสนทนา) — ถ้ายังไม่เคยถาม แค่จะจอง ต้องถามวัน/เวลาให้ครบก่อนแล้วค่อยแจ้งราคาในสรุปจอง
  const userTexts = [...history.filter((m) => m.role === 'user').map((m) => m.text), userMessage];
  const askedPrice = customerAskedPrice(userTexts);
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
              date: { type: Type.STRING, description: 'วันที่รับ ถ้าลูกค้าบอกแล้ว (เช่น 23/10/2026) — ถ้ายังไม่รู้ห้ามใส่/เว้นว่าง' },
              time: { type: Type.STRING, description: 'เวลารับ ถ้าลูกค้าบอกแล้ว (เช่น 13:00) — ถ้ายังไม่รู้ห้ามใส่/เว้นว่าง' },
              place_name: { type: Type.STRING, description: 'ชื่อโรงแรม/ที่พักตามที่ลูกค้าพิมพ์ — ใส่เฉพาะตอนที่คุณส่งชื่อ "ย่าน" แทนชื่อสถานที่นั้นใน origin/destination (เพราะระบบยังไม่รู้จักสถานที่) ระบบจะจดจำสถานที่นี้เข้าย่านนั้นให้ครั้งหน้า' },
              place_role: { type: Type.STRING, description: 'place_name เป็น "origin" (จุดรับ) หรือ "destination" (จุดส่ง) — ค่าเริ่มต้น destination' },
            },
            required: ['origin', 'destination', 'pax'],
          },
        },
        {
          name: 'list_prices_from',
          description:
            'รู้จุดรับแล้ว แต่ยังไม่รู้จุดส่ง (หรือจุดส่งไม่ชัด/ไม่มีราคา) → เรียกตัวนี้ ระบบจะแนบตารางราคาทุกปลายทางจากจุดรับนั้นให้ลูกค้าเอง (ใช้ได้ครั้งเดียวต่อบทสนทนา ห้ามเรียกถ้าลูกค้าบอกจุดส่งแล้ว)',
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

  const MENU_ALREADY_SENT = {
    status: 'menu_already_sent',
    message:
      'ส่งตารางราคาให้ลูกค้าไปแล้วในบทสนทนานี้ ห้ามส่งซ้ำ ห้ามเสนอทัวร์ซ้ำ — ถามเฉพาะข้อมูลที่ยังขาด (จุดส่ง/โรงแรม จำนวนคน วัน เวลา) หรือถ้ายังหาราคาเส้นทางไม่ได้ให้ถามย่านของสถานที่นั้น แล้วค่อยเรียก lookup_price ใหม่',
  };
  let priceQuoted: { price: number } | null = null;

  const MAX_TOOL_ROUNDS = 3;
  let response = await callModel(ai, contents, systemPrompt, tools);
  // ลูกค้าถามราคาและพูดถึงสถานที่ในตาราง แต่ Gemini ตอบเป็นข้อความเฉยๆ ไม่เรียก tool (เจอจริง: ทักทายอย่างเดียว ไม่มีตาราง) → ลองใหม่โดยบังคับเรียก tool ราคา 1 ครั้ง
  // เงื่อนไขแคบ: ต้องไม่มี tool call เลย + ข้อความมีคำถามราคา + มีชื่อสถานที่ที่รู้จัก (กันคำถามราคาทัวร์/FAQ ที่ไม่เกี่ยวกับตารางรถ)
  if (customerAskedPrice([userMessage]) && !(response.functionCalls?.length ?? 0)) {
    try {
      if ((await zonesInText(userMessage)).length > 0) {
        log.warn('gemini.price_tool_skipped_retry', {});
        response = await callModel(ai, contents, systemPrompt, tools, true);
      }
    } catch (err) {
      log.warn('gemini.price_tool_retry_failed', { err: (err as Error).message });
    }
  }

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
            if (already.menu) {
              result = MENU_ALREADY_SENT;
              log.info('gemini.price_menu', { status: 'skipped_already_sent' });
              return { functionResponse: { name: call.name, response: result } };
            }
            const m = await priceMenu(String(a.origin ?? ''), lang, paxN, { includeTourOffer: !already.tour });
            if (m.status === 'ok') {
              menuText = m.text;
              result = { status: 'menu_ready', origin_zone: m.originZone, destination_count: m.destinations.length, message: MENU_NOTE };
            } else {
              result = { status: 'not_found', message: 'ไม่รู้จักจุดรับนี้ ให้ถามลูกค้าว่าจุดรับอยู่ย่านไหน ถ้ายังไม่ทราบแจ้งว่าพี่แชมป์จะเช็คให้ และใส่ [HANDOFF]' };
            }
            log.info('gemini.price_menu', { status: m.status });
          } else if (call.name === 'lookup_price') {
            const args = (call.args ?? {}) as { origin?: string; destination?: string; pax?: number | string; date?: string; time?: string };
            const lp = await lookupPrice(String(args.origin ?? ''), String(args.destination ?? ''), Number(args.pax));
            result = { ...lp };
            const dateTimeKnown = String(args.date ?? '').trim() !== '' && String(args.time ?? '').trim() !== '';
            if (result.status === 'ok' && askedPrice && !dateTimeKnown) {
              // ลูกค้าถามราคา ตอบราคาได้ แต่ยังไม่ครบวัน/เวลา → ห้ามใช้แบบฟอร์ม "สรุปการจอง" (ให้แสดงเมื่อครบ 5 อย่างเท่านั้น)
              result.instruction =
                'ยังไม่ครบวันที่+เวลารับ: ตอบราคาเป็นประโยคสั้นๆ 1 ประโยค แล้วถามวัน/เวลาที่ขาดตรงๆ ห้ามใช้แบบฟอร์ม "สรุปการจอง" (📅📍👥💰) จนกว่าจะรู้วันที่และเวลาครบ';
            }
            if (result.status === 'ok' && !askedPrice) {
              // ลูกค้ายังไม่เคยถามราคา → ห้ามบอกราคาตอนนี้ (ยังเก็บรายละเอียดไม่ครบ) ถามวัน/เวลาที่ขาดก่อน
              result.instruction =
                'ลูกค้ายังไม่ได้ถามราคา: ห้ามบอกราคาในรอบนี้เด็ดขาด (ห้ามพิมพ์ตัวเลขราคา) ถ้ายังไม่ครบวันที่+เวลารับ ให้ถามที่ขาดตรงๆ เช่น "ต้องการเดินทางวันที่เท่าไหร่ เวลากี่โมงครับ?" ถ้าครบแล้วจึงแสดงสรุปการจองพร้อมราคา';
            }
            log.info('gemini.price_lookup', { status: result.status });
            // หาราคาไม่เจอ/กำกวม → ไม่แนบตารางเอง (แชมป์สั่ง 8 ต.ค. 2026: ขึ้นขายครั้งเดียว ถามรายละเอียดให้ครบก่อน)
            // Gemini ถามย่านของสถานที่แล้วเรียก lookup_price ใหม่ — ตารางส่งได้เฉพาะผ่าน list_prices_from (ลูกค้าถามราคากว้างๆ) ครั้งเดียวต่อบทสนทนา
            // จำสถานที่ที่ระบบยังไม่รู้จักเข้าย่านที่ลูกค้าบอก (หรือที่ Gemini มั่นใจ) — ไม่ทำให้การตอบล้มถ้าบันทึกไม่ได้
            await learnPlace(args, lp, userTexts).catch((err) => log.warn('gemini.learn_place_failed', { err: (err as Error).message }));
            if (result.status === 'ok' && typeof result.price === 'number') {
              priceQuoted = { price: result.price };
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

  if (menuText) return `${reply}\n\n${menuText}`;

  // แจ้งราคาแล้ว (ราคาปรากฏในคำตอบ) และยังไม่เคยเสนอทัวร์ → เสนอทัวร์ 1 ครั้ง ต่อท้ายราคา แล้วหลังจากนั้นโฟกัสการจองรถ
  // ไม่ต่อท้ายในข้อความที่เป็นการยืนยันจอง ([BOOKING_CONFIRMED]) เพราะลูกค้ากำลังจะจ่ายเงิน
  const quoted = priceQuoted as { price: number } | null;
  if (quoted && !already.tour && !reply.includes('[BOOKING_CONFIRMED]')) {
    const p = quoted.price;
    if (reply.includes(p.toLocaleString('en-US')) || reply.includes(String(p))) {
      return `${reply}\n\n${tourOfferText(lang)}`;
    }
  }
  return reply;
}
