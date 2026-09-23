// app/api/dispatch/match-now/route.ts — manual trigger for lib/dispatch-match.ts's
// runDispatchMatch(), same auth pattern as the other dispatch cron endpoints.
// Not on any Vercel Cron schedule — the instant path already fires from
// driver-flow.ts right after "avail:submit", and the 30-min ctt-dispatch-check
// scheduled task covers everything else. This route exists purely so แชมป์ (or a
// debugging session) can re-run the matcher on demand without waiting for either.

import { runDispatchMatch } from '@/lib/dispatch-match';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('unauthorized', { status: 401 });
  }

  const result = await runDispatchMatch();
  log.info('dispatch_match_now.done', result);
  return new Response(JSON.stringify({ ok: true, ...result }), { status: 200 });
}
