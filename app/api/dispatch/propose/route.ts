// app/api/dispatch/propose/route.ts — receives computed match proposals from
// external callers (historically the `ctt-dispatch` Claude Code skill, Agent 6)
// and pushes a Telegram confirm card to แชมป์. The skill never talks to
// Telegram/LINE itself — this app holds all tokens.
//
// The instant post-submit matcher (lib/dispatch-match.ts) computes and sends its
// own proposals in-process instead of calling this route — both paths share the
// same send/dedup logic via lib/dispatch-propose.ts.
//
// Auth: shared secret header, not a LINE/Telegram signature (this is a
// server-to-server call from an external caller, not a user webhook).

import { processDispatchProposals, Proposal } from '@/lib/dispatch-propose';
import { log } from '@/lib/log';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const secret = req.headers.get('x-dispatch-secret');
  if (!secret || secret !== process.env.DISPATCH_API_SECRET) {
    log.warn('dispatch_propose.unauthorized');
    return new Response('unauthorized', { status: 401 });
  }

  const { proposals } = (await req.json()) as { proposals: Proposal[] };
  if (!Array.isArray(proposals) || proposals.length === 0) {
    return new Response('ok', { status: 200 });
  }

  await processDispatchProposals(proposals);
  return new Response('ok', { status: 200 });
}
