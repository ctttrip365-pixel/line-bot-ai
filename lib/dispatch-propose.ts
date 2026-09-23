// lib/dispatch-propose.ts — turns computed driver↔booking proposals into an
// Assignments_Log row (status=proposed) + a Telegram confirm card for แชมป์.
// Shared by two callers so both send identically formatted cards and share the
// same duplicate-proposal guards:
//   - app/api/dispatch/propose/route.ts (external POST — historically from the
//     Claude Code ctt-dispatch skill, still reachable if that path is ever used again)
//   - lib/dispatch-match.ts (the instant in-process matcher, triggered right after
//     a driver submits availability — see driver-flow.ts's avail:submit handler)
//
// Now that proposals can fire from more than one trigger (scheduled skill run,
// instant post-submit run) for the same booking within a short window, guard
// against duplicate Sheet rows / duplicate Telegram cards with short Redis locks.

import { Redis } from '@upstash/redis';
import { proposeAssignment, confirmAssignment } from './assignments';
import { sendTelegramMessage } from './telegram';
import { log } from './log';

export interface ProposalWithMatch {
  noMatch?: false;
  bookingEventId: string;
  calendarId: string;
  jobDate: string; // YYYY-MM-DD
  jobStartTime: string; // HH:MM
  summaryText: string; // e.g. "VTL3050 | Mr.Smith | Krabi Airport→Ao Nang"
  driverId: string;
  driverDisplayName: string;
  // true เฉพาะ booking ที่ไม่เคยมีคนขับมาก่อนเลย ("fresh" ตามที่แชมป์นิยาม — ไม่เกี่ยวกับวันที่รับ booking
  // เข้ามา) — ข้ามขั้น "รอกดยืนยัน" ไปเลย ยืนยันอัตโนมัติทันที (ยังแจ้ง Telegram แบบ FYI + ปุ่มเปลี่ยนคนขับ
  // ไว้เผื่อแชมป์อยากสลับทีหลัง) ส่วน booking ที่เคย confirmed แล้วแต่ถูกปลดกลับมา (needs_reassignment —
  // เช่นจากการอนุมัติลา) ยังต้องผ่านขั้นกดยืนยันเหมือนเดิมเสมอ ไม่ auto-confirm ให้
  autoConfirm?: boolean;
}

export interface ProposalNoMatch {
  noMatch: true;
  bookingEventId: string;
  jobDate: string;
  jobStartTime?: string; // HH:MM — optional, not all noMatch proposals know the pickup time yet
  summaryText: string;
  reason: string;
}

export type Proposal = ProposalWithMatch | ProposalNoMatch;

function getRedis(): Redis {
  return new Redis({
    url: (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)!,
    token: (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)!,
  });
}

// รอบ cron (ทุก 30 นาที) กับรอบ instant (ทันทีที่คนขับส่งวันว่าง) มีโอกาสชนกันในหน้าต่างสั้นๆ —
// ล็อกกันเสนอ booking เดียวกันซ้ำสอง (สอง proposed row / สองการ์ด Telegram)
const PROPOSE_LOCK_TTL_SECONDS = 60;
// กัน Telegram สแปมซ้ำถ้ายังหาคนขับไม่ได้ต่อเนื่องหลายรอบ (เช่น instant trigger ยิงถี่ตอนหลายคน
// ส่งวันว่างใกล้ๆ กัน แต่ booking นี้ก็ยังไม่มีใครว่างเหมือนเดิม)
const NO_MATCH_ALERT_TTL_SECONDS = 12 * 60 * 60;

export async function processDispatchProposals(proposals: Proposal[]): Promise<void> {
  if (proposals.length === 0) return;
  const redis = getRedis();
  let sentCount = 0;

  for (const p of proposals) {
    if (p.noMatch) {
      const alertKey = `dispatch_no_match_alerted:${p.bookingEventId}`;
      let alreadyAlerted = false;
      try {
        alreadyAlerted = (await redis.set(alertKey, '1', { nx: true, ex: NO_MATCH_ALERT_TTL_SECONDS })) === null;
      } catch (err) {
        log.error('dispatch_propose.redis_failed', { err: (err as Error).message });
      }
      if (alreadyAlerted) continue;

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
      sentCount += 1;
      continue;
    }

    const lockKey = `dispatch_propose_lock:${p.bookingEventId}`;
    let acquired = true;
    try {
      acquired = (await redis.set(lockKey, '1', { nx: true, ex: PROPOSE_LOCK_TTL_SECONDS })) !== null;
    } catch (err) {
      log.error('dispatch_propose.redis_failed', { err: (err as Error).message });
      // Redis ล่ม — ยอมเสี่ยงเสนอซ้ำ (แชมป์กดยืนยันผิดคนได้ทีหลัง) ดีกว่าไม่เสนอเลยเงียบๆ
    }
    if (!acquired) {
      log.info('dispatch_propose.skipped_locked', { bookingEventId: p.bookingEventId });
      continue;
    }

    if (p.autoConfirm) {
      // fresh booking (ไม่เคยมีคนขับมาก่อนเลย) — ยืนยันอัตโนมัติทันทีตามที่แชมป์ตัดสินใจ (2026-09-23)
      // ไม่ต้องรอกดยืนยันใน Telegram แล้ว ยังคง Driver: ใน Calendar description ให้เหมือนเดิมทุกอย่าง
      await confirmAssignment(p.bookingEventId, p.driverId, p.driverDisplayName);
      await sendTelegramMessage(
        [
          '✅ <b>จับคู่คนขับอัตโนมัติแล้ว</b>',
          `งาน: ${p.summaryText}`,
          `วันที่: ${p.jobDate} ${p.jobStartTime}`,
          `คนขับ: ${p.driverDisplayName}`,
        ].join('\n'),
        [[{ text: '🔄 เปลี่ยนคนขับ', callback_data: `reassign:${p.bookingEventId}` }]]
      );
      sentCount += 1;
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
    sentCount += 1;
  }

  log.info('dispatch_propose.sent', { count: sentCount, received: proposals.length });
}
