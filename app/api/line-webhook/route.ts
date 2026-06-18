import { NextRequest, NextResponse } from 'next/server';
import { validateSignature, webhook } from '@line/bot-sdk';
import { getFaqText } from '@/lib/sheet';
import { getGeminiReply, DEFAULT_REPLY } from '@/lib/gemini';
import { replyText } from '@/lib/line';

const TIMEOUT_MS = 8_000; // LINE drops requests after ~10 s; we bail at 8 s

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms);
    }),
  ]);
}

export async function POST(req: NextRequest) {
  // 1. Read raw body — needed for signature verification
  const body = await req.text();
  const signature = req.headers.get('x-line-signature') ?? '';

  // 2. Verify signature — reject immediately if invalid
  if (!validateSignature(body, process.env.LINE_CHANNEL_SECRET!, signature)) {
    console.warn('[webhook] invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let parsed: { events: webhook.Event[] };
  try {
    parsed = JSON.parse(body) as { events: webhook.Event[] };
  } catch {
    return NextResponse.json({ error: 'Bad JSON' }, { status: 400 });
  }

  // 3. Process only text message events; run all concurrently
  const textEvents = parsed.events.filter(
    (e): e is webhook.MessageEvent =>
      e.type === 'message' &&
      'message' in e &&
      (e as webhook.MessageEvent).message.type === 'text',
  );

  await Promise.allSettled(
    textEvents.map(async (event) => {
      const userMessage = (event.message as { type: 'text'; text: string }).text;
      let reply = DEFAULT_REPLY;

      try {
        // 4–5. Fetch FAQ + call Gemini, both must finish within TIMEOUT_MS
        reply = await withTimeout(
          (async () => {
            const faqText = await getFaqText();
            return getGeminiReply(faqText, userMessage);
          })(),
          TIMEOUT_MS,
        );
      } catch (err) {
        console.error('[webhook] processing error:', err);
        // reply stays as DEFAULT_REPLY
      }

      // 6. Reply back to LINE
      try {
        await replyText(event.replyToken!, reply);
      } catch (err) {
        // LINE will retry if we return non-200; log and fall through to 200
        console.error('[webhook] reply error:', err);
      }
    }),
  );

  // 7. Always return 200 so LINE does not retry
  return NextResponse.json({ ok: true });
}
