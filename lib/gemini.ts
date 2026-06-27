// lib/gemini.ts — Gemini wrapper with conversation history support
// history ถูกโลดจาก Redis และส่งมาที่นี่ เพื่อให้ Gemini จำบทสนทนาได้

import { GoogleGenAI } from '@google/genai';
import { buildSystemPrompt } from './prompts';
import type { ChatMessage } from './history';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const MODEL = 'gemini-2.5-flash';

export const DEFAULT_REPLY =
  'ขออภัยนะครับ ขอเวลาเช็คให้สักครู่ได้เลยครับ 🙏 หรือโทรหาพี่แชมป์ได้เลยครับ';

export async function generateReply(
  userMessage: string,
  faqText: string,
  history: ChatMessage[] = []
): Promise<string> {
  const startTime = Date.now();
  const systemPrompt = buildSystemPrompt(faqText, DEFAULT_REPLY);

  // Build contents array: history turns + current user message
  const contents = [
    ...history.map((msg) => ({
      role: msg.role as 'user' | 'model',
      parts: [{ text: msg.text }],
    })),
    { role: 'user' as const, parts: [{ text: userMessage }] },
  ];

  const response = await ai.models.generateContent({
    model: MODEL,
    contents,
    config: {
      systemInstruction: systemPrompt,
      temperature: 1.0,
      maxOutputTokens: 1024,
    },
  });

  const usage = response.usageMetadata;
  const finishReason = response.candidates?.[0]?.finishReason;

  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: 'gemini.reply',
      latencyMs: Date.now() - startTime,
      historyTurns: history.length / 2,
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
