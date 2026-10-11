// lib/sidejob-daily.ts — งานตามเวลาของสมุดบัญชีงานที่ขับให้เพื่อน
//  1) ทุกเช้า (cron refresh-day-status ~09:00 ไทย): ถามงานที่ผ่านวันงานแล้วและยังไม่ยืนยัน "ขับจริงไหม / มีค่าใช้จ่ายเพิ่มไหม"
//  2) เช้าวันที่ 1: ส่งสรุปเดือนที่แล้วแยกรายเพื่อน (ข้อความพร้อมก๊อปส่งเพื่อน)
//  3) คำสั่ง /สรุป [เพื่อน] [เดือน] เมื่อไหร่ก็ได้
// อ่านชีตไม่ได้ = ต้องบอกแชมป์ (ห้ามเงียบ — ไม่งั้นแชมป์จะคิดว่า "ไม่มีงานค้าง")

import {
  listSideJobs,
  listOwners,
  jobsAwaitingConfirmation,
  confirmationText,
  buildMonthlySummaries,
  previousMonth,
  monthLabelTh,
  bangkokToday,
  parseSummaryArgs,
  escapeHtml,
} from './sidejobs';
import { sendTelegramMessage, type InlineButton } from './telegram';
import { log } from './log';

const MAX_PER_RUN = 10;

export function confirmButtons(jobId: string): InlineButton[][] {
  return [
    [
      { text: '✅ ขับจริง', callback_data: `sj_driven:${jobId}` },
      { text: '❌ ไม่ได้ขับ', callback_data: `sj_notdriven:${jobId}` },
    ],
    [{ text: '💰 ขับจริง + มีค่าใช้จ่ายเพิ่ม', callback_data: `sj_extra:${jobId}` }],
  ];
}

export async function sendSideJobConfirmations(now = Date.now()): Promise<{ asked: number; remaining: number }> {
  let jobs, owners;
  try {
    [jobs, owners] = await Promise.all([listSideJobs(), listOwners()]);
  } catch (err) {
    log.error('sidejob_daily.read_failed', { err: (err as Error).message });
    await sendTelegramMessage('⚠️ เช้านี้ดึงงานที่รอยืนยัน "ขับจริงไหม" ไม่ได้ (Apps Script ไม่ตอบ) — ไม่ได้แปลว่าไม่มีงานค้าง ลองพิมพ์ /สรุป ดูได้ครับ');
    throw err;
  }
  const waiting = jobsAwaitingConfirmation(jobs, bangkokToday(now));
  if (waiting.length === 0) return { asked: 0, remaining: 0 };

  const batch = waiting.slice(0, MAX_PER_RUN);
  await sendTelegramMessage(`🕘 <b>งานที่ขับให้เพื่อนรอยืนยัน ${waiting.length} งาน</b> — กดตอบทีละงานได้เลยครับ`);
  for (const j of batch) {
    const name = owners.find((o) => o.owner_id === j.owner_id)?.display_name ?? j.owner_id;
    await sendTelegramMessage(confirmationText(j, name), confirmButtons(j.job_id));
  }
  const remaining = waiting.length - batch.length;
  if (remaining > 0) await sendTelegramMessage(`…ยังเหลืออีก ${remaining} งาน จะถามต่อพรุ่งนี้เช้าครับ`);
  return { asked: batch.length, remaining };
}

async function sendSummaryMessages(month: string, ownerId?: string, intro?: string): Promise<number> {
  const chunks = await buildMonthlySummaries(month, ownerId);
  if (intro) await sendTelegramMessage(intro);
  for (const c of chunks) await sendTelegramMessage(c);
  return chunks.length;
}

/** เช้าวันที่ 1 (เวลาไทย) → ส่งสรุปเดือนที่แล้วแยกรายเพื่อน; วันอื่น = ไม่ทำอะไร */
export async function sendMonthlySummariesIfFirstDay(now = Date.now()): Promise<{ sent: boolean; month?: string }> {
  if (bangkokToday(now).slice(8) !== '01') return { sent: false };
  const month = previousMonth(now);
  try {
    await sendSummaryMessages(
      month,
      undefined,
      `📒 <b>สรุปงานที่ขับให้เพื่อน เดือน${escapeHtml(monthLabelTh(month))}</b>\nกดค้างที่กล่องข้อความ → คัดลอก แล้วส่งให้เพื่อนได้เลย (งานที่ยังรอยืนยันไม่นับในยอด)`
    );
  } catch (err) {
    log.error('sidejob_daily.summary_failed', { err: (err as Error).message });
    await sendTelegramMessage('⚠️ ทำสรุปสิ้นเดือนไม่ได้ (Apps Script ไม่ตอบ) — ลองพิมพ์ /สรุป อีกครั้งในอีก 1 นาทีครับ');
    throw err;
  }
  return { sent: true, month };
}

/** /สรุป [เพื่อน] [เดือน] */
export async function handleSummaryCommand(args: string, now = Date.now()): Promise<void> {
  try {
    const owners = await listOwners();
    const parsed = parseSummaryArgs(args, owners, now);
    if (!parsed.ok) {
      await sendTelegramMessage(`❓ ${escapeHtml(parsed.error)}`);
      return;
    }
    await sendSummaryMessages(parsed.month, parsed.owner?.owner_id);
  } catch (err) {
    log.error('sidejob_daily.summary_cmd_failed', { err: (err as Error).message });
    await sendTelegramMessage('⚠️ ทำสรุปไม่ได้ (Apps Script ไม่ตอบ) — ไม่ได้แปลว่าไม่มีงาน ลองพิมพ์ /สรุป อีกครั้งในอีก 1 นาทีครับ');
  }
}
