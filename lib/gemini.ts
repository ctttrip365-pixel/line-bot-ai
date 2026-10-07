// lib/gemini.ts — Gemini wrapper with conversation history support
// history ถูกโลดจาก Redis และส่งมาที่นี่ เพื่อให้ Gemini จำบทสนทนาได้

import { GoogleGenAI, Type } from '@google/genai';
import type { Content } from '@google/genai';
import { lookupPrice } from './prices';
import { log } from './log';
import { buildSystemPrompt } from './prompts';
import type { ChatMessage } from './history';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const MODEL = 'gemini-2.5-flash';

export const DEFAULT_REPLY =
  'ขออภัยนะครับ ขอเวลาเช็คให้สักครู่ได้เลยครับ 🙏 หรือโทรหาพี่แชมป์ได้เลยครับที่ +66 94 269 4651';

export async function generateReply(
  userMessage: string,
  faqText: string,
  history: ChatMessage[] = []
): Promise<string> {
  const startTime = Date.now();
  // ส่ง isFirstMessage เพื่อให้บอทไม่ทักสวัสดีซ้ำในบทสนทนาต่อเนื่อง
  const isFirstMessage = history.length === 0;
  const systemPrompt = buildSystemPrompt(faqText, DEFAULT_REPLY, isFirstMessage);

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
      ],
    },
  ];

  const MAX_TOOL_ROUNDS = 3;
  let response = await ai.models.generateContent({
    model: MODEL,
    contents,
    config: { systemInstruction: systemPrompt, temperature: 1.0, maxOutputTokens: 1024, tools },
  });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const calls = response.functionCalls;
    if (!calls || calls.length === 0) break;
    const modelContent = response.candidates?.[0]?.content;
    if (modelContent) contents.push(modelContent);

    const responseParts = await Promise.all(
      calls.map(async (call) => {
        let result: Record<string, unknown>;
        try {
          if (call.name !== 'lookup_price') throw new Error(`unknown tool ${call.name}`);
          const args = (call.args ?? {}) as { origin?: string; destination?: string; pax?: number | string };
          result = { ...(await lookupPrice(String(args.origin ?? ''), String(args.destination ?? ''), Number(args.pax))) };
          log.info('gemini.price_lookup', { status: result.status });
        } catch (err) {
          log.error('gemini.price_lookup_failed', { err: (err as Error).message });
          // ค้นราคาไม่ได้ (Sheet ล่ม ฯลฯ) → ให้ส่งต่อแชมป์ ไม่ให้เดาราคา
          result = { status: 'handoff', reason: 'price_lookup_error', message: 'ค้นราคาไม่ได้ชั่วคราว ห้ามบอกราคา แจ้งว่าพี่แชมป์จะเช็คให้' };
        }
        return { functionResponse: { name: call.name, response: result } };
      })
    );
    contents.push({ role: 'user', parts: responseParts });

    response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: { systemInstruction: systemPrompt, temperature: 1.0, maxOutputTokens: 1024, tools },
    });
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
    return DEFAULT_REPLY;
  }

  const reply = response.text?.trim();
  if (!reply) throw new Error('gemini_empty_response');

  return reply;
}
