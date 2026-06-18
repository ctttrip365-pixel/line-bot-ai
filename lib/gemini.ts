// lib/gemini.ts — Gemini wrapper (timeout · truncation guard · token logging)
// ⚠️ gemini-2.5-flash: maxOutputTokens นับ output อย่างเดียว · 200 พอ
// ⚠️ gemini-2.5-flash-preview / 3.x: นับ thinking + output รวม · ต้องตั้ง 1024+

import { GoogleGenAI } from '@google/genai';
import { buildSystemPrompt } from './prompts';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const MODEL = 'gemini-2.0-flash';

export const DEFAULT_REPLY =
  'ขออภัยนะครับ ขอเวลาเช็คให้สักครู่ได้เลยครับ 🙏 หรือโทรหาพี่แชมป์ได้เลยครับ';

export async function generateReply(
  userMessage: string,
  faqText: string
): Promise<string> {
  const startTime = Date.now();

  const systemPrompt = buildSystemPrompt(faqText, DEFAULT_REPLY);

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: userMessage,
    config: {
      systemInstruction: systemPrompt,
      temperature: 1.0,
      maxOutputTokens: 1024, // เผื่อ thinking budget (preview model นับรวมกัน)
    },
  });

  const usage = response.usageMetadata;
  const finishReason = response.candidates?.[0]?.finishReason;

  // Token logging — ช่วย tune cap ใน Vercel logs
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: 'gemini.reply',
      latencyMs: Date.now() - startTime,
      inputLength: userMessage.length,
      outputLength: response.text?.length ?? 0,
      finishReason,
      thoughtsTokenCount: usage?.thoughtsTokenCount ?? 0,
      candidatesTokenCount: usage?.candidatesTokenCount ?? 0,
      totalTokenCount: usage?.totalTokenCount ?? 0,
    })
  );

  // Truncation guard: ถ้า budget หมด อย่าส่งครึ่งประโยคให้ลูกค้า
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
  if (!reply) {
    throw new Error('gemini_empty_response');
  }

  return reply;
}
