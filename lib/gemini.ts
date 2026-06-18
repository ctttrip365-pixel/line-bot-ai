import { GoogleGenAI } from '@google/genai';

// gemini-2.5-flash is the latest flash model (brief referred to it as "gemini-3.5-flash")
const MODEL = 'gemini-2.5-flash';

export const DEFAULT_REPLY =
  'ขอโทษนะครับ พี่แชมป์ขอเวลาเช็คข้อมูลสักครู่นะครับ 🙏 ลองส่งข้อความมาใหม่อีกทีได้เลยครับ';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

function buildPrompt(faqText: string, userMessage: string): string {
  return `<role>
คุณคือพี่แชมป์ เจ้าของและคนดูแล Champion Tour and Transport (CTT)
ธุรกิจรถตู้ส่วนตัวรับส่งนักท่องเที่ยว จังหวัดกระบี่ พีพี ลันตา ภูเก็ต
</role>

<constraints>
- ตอบโดยใช้ข้อมูลใน <faq> เท่านั้น ห้ามแต่งราคา เวลา หรือสถานที่ที่ไม่มีในข้อมูล
- ถ้าคำถามไม่มีคำตอบใน <faq> ให้ตอบด้วยข้อความนี้เป๊ะๆ:
  "เรื่องนี้พี่แชมป์ ยังไม่มีข้อมูลในส่วนนี้ ขอเวลาให้ทีมงานช่วยตรวจสอบให้อีกทีนะครับ 🙏 หรือโทรมาได้เลยครับ"
- โทนเป็นกันเอง เหมือนคุยกับเพื่อน ใส่ emoji ได้ตามความเหมาะสม (ไม่เกิน 1-2 อันต่อข้อความ)
- ความยาวคำตอบ 1-3 ประโยค กระชับ ไม่อ้อม
</constraints>

<output_format>
ภาษาไทย ไม่ใช้ markdown ไม่ใช้ bullet point
</output_format>

<faq>
${faqText}
</faq>

<question>
${userMessage}
</question>`;
}

export async function getGeminiReply(
  faqText: string,
  userMessage: string,
): Promise<string> {
  const prompt = buildPrompt(faqText, userMessage);

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      temperature: 1.0,      // ห้ามแก้
      maxOutputTokens: 1024, // ห้ามแก้
    },
  });

  const finishReason = response.candidates?.[0]?.finishReason;
  const thoughtsTokenCount = response.usageMetadata?.thoughtsTokenCount;
  const candidatesTokenCount = response.usageMetadata?.candidatesTokenCount;

  console.log(
    `[gemini] finishReason=${finishReason} | thoughts=${thoughtsTokenCount} | candidates=${candidatesTokenCount}`,
  );

  if (finishReason === 'MAX_TOKENS') {
    console.warn('[gemini] MAX_TOKENS hit — returning default reply');
    return DEFAULT_REPLY;
  }

  return response.text ?? DEFAULT_REPLY;
}
