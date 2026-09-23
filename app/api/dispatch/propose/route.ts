// app/api/dispatch/propose/route.ts — receives computed match proposals from the
// `ctt-dispatch` Claude Code skill (Agent 6) and pushes a Telegram confirm card to
// แชมป์. The skill never talks to Telegram/LINE itself — this app holds all tokens.
//
// Auth: shared secret header, not a LINE/Telegram signature (this is a
// server-to-server call from Claude Code's scheduled task, not a user webhook).

import { proposeAssignment } from '@/lib/assignments';
import { sendTelegramMessage } from '@/lib/telegram';
import { log } from '@/lib/log';

export const runtime = 'nodejs';

interface ProposalWithMatch {
  noMatch?: false;
  bookingEventId: string;
  calendarId: string;
  jobDate: string; // YYYY-MM-DD
  jobStartTime: string; // HH:MM
  summaryText: string; // e.g. "VTL3050 | Mr.Smith | Krabi Airport→Ao Nang"
  driverId: string;
  driverDisplayName: string;
}

interface ProposalNoMatch {
  noMatch: true;
  bookingEventId: string;
  jobDate: string;
  jobStartTime?: string; // HH:MM — optional, not all noMatch proposals know the pickup time yet
  summaryText: string;
  reason: string;
}

type Proposal = ProposalWithMatch | ProposalNoMatch;

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

  for (const p of proposals) {
    if (p.noMatch) {
      await sendTelegramMessage(
        [
          '⚠️ <b>ไม่มีคนขับในทีมว่าง</b>',
          `งาน: ${p.summaryText}`,
          `วันที่: ${p.jobDate}${p.jobStartTime ? ` ${p.jobStartTime}` : ''}`,
          `เหตุผล: ${p.reason}`,
          '',
          'กด "จัดคนขับเอง" เพื่อเลือกคนขับด้วยมือได้เลย (เช่น คนขับสำรองที่ไม่มี LINE) หรือถ้าไม่มีใครในทีมจริงๆ ต้องหารถนอกเอง',
        ].join('\n'),
        [[{ text: '👤 จัดคนขับเอง', callback_data: `reassign:${p.bookingEventId}` }]]
      );
      continue;
    }

    await proposeAssignment({
      bookingEventId: p.bookingEventId,
      calendarId: p.calendarId,
      driverId: p.driverId,
      jobDate: p.jobDate,
      jobStartTime: p.jobStartTime,
    });

    await sendTelegramMessage(
      [
        '🚐 <b>เสนอจับคู่คนขับ</b>',
        `งาน: ${p.summaryText}`,
        `วันที่: ${p.jobDate} ${p.jobStartTime}`,
        `คนขับที่เสนอ: ${p.driverDisplayName}`,
      ].join('\n'),
      [
        [
          {
            text: '✅ ยืนยัน',
            callback_data: `confirm_assign:${p.bookingEventId}:${p.driverId}:${p.driverDisplayName}`,
          },
          { text: '🔄 เปลี่ยนคนขับ', callback_data: `reassign:${p.bookingEventId}` },
        ],
      ]
    );
  }

  log.info('dispatch_propose.sent', { count: proposals.length });
  return new Response('ok', { status: 200 });
}
