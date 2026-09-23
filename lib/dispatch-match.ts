// lib/dispatch-match.ts — deterministic driver↔booking auto-matcher, the
// in-process replacement for what the Claude Code "ctt-dispatch" skill (Agent 6)
// used to compute on its own schedule. Triggered two ways now:
//   1. Instantly, right after a driver submits availability (driver-flow.ts's
//      avail:submit handler, via next/server's after() so it doesn't delay the
//      LINE reply) — แชมป์ sees a match proposal in Telegram within seconds.
//   2. The scheduled_tasks cron `ctt-dispatch-check` (every 30 min, 7:00-23:00)
//      as a safety net for cases that don't originate from a submit — a brand
//      new booking landing on the Calendar, or a leave approval reopening one.
//
// Deliberately plain rule-based code, not an LLM judgment call — same rule the
// original skill used (available that day + fewest jobs that day + no time
// conflict), just executed inline so it can run for free in milliseconds instead
// of spinning up an agent session.
//
// Confirmation gate (แชมป์'s decision, 2026-09-23, extended same day): any
// booking with no row yet, or a row still sitting at "proposed" (never got a
// Telegram button tap), auto-confirms the moment a match is found — no manual
// tap needed, regardless of how long it's been sitting unconfirmed or whether
// this is its first match attempt or a re-run. A booking reopened via an
// approved leave request (status needs_reassignment) is the one exception —
// that path still goes through the propose-then-confirm flow, same as before,
// since it follows a leave-approval decision Champ already made deliberately
// and the driver swap still deserves a final look (CLAUDE.md §7 "ปรัชญาการออกแบบ
// agent").

import { listCalendarEvents, isBookingEvent } from './gas-client';
import { listDrivers, Driver } from './drivers';
import { listAssignments, hasConflict, AssignmentRow } from './assignments';
import { getAllAvailabilityForMonth, getChampAvailability } from './availability';
import { toBangkokParts, monthsInRollingRange } from './date-range';
import { parseBookingDescription } from './booking-parse';
import { processDispatchProposals, Proposal } from './dispatch-propose';
import { invalidateJobsCache } from './job-availability';
import { log } from './log';

const MATCH_WINDOW_DAYS = 14; // เท่ากับ window เดิมที่ ctt-dispatch skill ใช้
const DEFAULT_JOB_DURATION_HOURS = 2; // ค่า conservative เดียวกับที่ hasConflict() ใช้กับงานอื่นอยู่แล้ว

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function buildAvailabilityIndex(months: string[]): Promise<Map<string, Set<string>>> {
  const rows = (await Promise.all(months.map((m) => getAllAvailabilityForMonth(m)))).flat();
  const byDriver = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.available_dates) continue;
    const set = byDriver.get(row.driver_id) ?? new Set<string>();
    row.available_dates.split(',').forEach((t) => set.add(t.trim()));
    byDriver.set(row.driver_id, set);
  }
  return byDriver;
}

// token เก็บเป็น "YYYY-MM-DD" (ว่างทั้งวัน ไม่ผูกงาน) หรือ "YYYY-MM-DD#eventId" (ว่างเฉพาะงานนั้น) —
// ดู lib/job-availability.ts สำหรับกฎเต็ม
function isDriverAvailableForJob(
  availIndex: Map<string, Set<string>>,
  driverId: string,
  jobDate: string,
  eventId: string
): boolean {
  const tokens = availIndex.get(driverId);
  if (!tokens) return false;
  return tokens.has(jobDate) || tokens.has(`${jobDate}#${eventId}`);
}

export async function runDispatchMatch(): Promise<{ proposed: number; noMatch: number }> {
  const today = new Date();
  const windowEnd = new Date(today);
  windowEnd.setDate(windowEnd.getDate() + MATCH_WINDOW_DAYS);
  const fromIso = `${toIsoDate(today)}T00:00:00+07:00`;
  const toIso = `${toIsoDate(windowEnd)}T23:59:59+07:00`;

  const [calRes, assignments, drivers, availIndex, champDates] = await Promise.all([
    listCalendarEvents(fromIso, toIso),
    listAssignments(),
    listDrivers(),
    buildAvailabilityIndex(monthsInRollingRange()),
    getChampAvailability(fromIso, toIso),
  ]);

  if (!calRes.ok || !calRes.data) {
    log.error('dispatch_match.calendar_read_failed', { error: calRes.error });
    return { proposed: 0, noMatch: 0 };
  }

  const activeDrivers = drivers.filter((d) => String(d.active).toUpperCase() === 'TRUE');

  // booking ที่ยังไม่มีแถวเลย, หรือแถวล่าสุดสถานะ "proposed" (เสนอไปแล้วแต่แชมป์ยังไม่กดยืนยัน —
  // ขยายให้ auto-confirm ครอบคลุมด้วยตามที่แชมป์ยืนยัน 2026-09-23), หรือ needs_reassignment
  // (เพิ่งอนุมัติลาไป) — ทั้งสามนับว่า "ยังไม่มีคนขับ [จริง]" ต้องลองจับคู่ใหม่ทุกครั้งที่รันมา
  const latestByEvent = new Map<string, AssignmentRow>();
  for (const a of assignments) latestByEvent.set(a.booking_event_id, a);
  const unmatched = calRes.data.filter(isBookingEvent).filter((ev) => {
    const row = latestByEvent.get(ev.eventId);
    return !row || row.status === 'needs_reassignment' || row.status === 'proposed';
  });

  if (unmatched.length === 0) return { proposed: 0, noMatch: 0 };

  // auto-confirm ทุกอย่างยกเว้น needs_reassignment (มาจากอนุมัติลา — ยังต้องผ่านขั้นกดยืนยันเสมอ)
  const isAutoConfirmEligible = (eventId: string) => latestByEvent.get(eventId)?.status !== 'needs_reassignment';

  const jobCountThatDay = (driverId: string, jobDate: string) =>
    assignments.filter((a) => a.driver_id === driverId && a.job_date === jobDate && a.status !== 'cancelled').length;

  const proposals: Proposal[] = unmatched.map((ev) => {
    const { date: jobDate, time: jobStartTime } = toBangkokParts(ev.start);
    const parsed = parseBookingDescription(ev.description);
    const summaryText =
      [parsed.bookingNo, parsed.guest, parsed.from && parsed.to ? `${parsed.from}→${parsed.to}` : ''].filter(Boolean).join(' | ') ||
      ev.summary;

    const candidates = activeDrivers.filter((d: Driver) => {
      const isAvailable =
        d.role === 'owner' ? champDates.includes(jobDate) : isDriverAvailableForJob(availIndex, d.driver_id, jobDate, ev.eventId);
      if (!isAvailable) return false;
      return !hasConflict(assignments, d.driver_id, jobDate, jobStartTime, DEFAULT_JOB_DURATION_HOURS);
    });

    if (candidates.length === 0) {
      return {
        noMatch: true,
        bookingEventId: ev.eventId,
        jobDate,
        jobStartTime,
        summaryText,
        reason: 'ไม่มีคนขับว่างตามที่ทุกคนแจ้งไว้ (หรือคนที่ว่างชนเวลากับงานอื่นอยู่)',
      };
    }

    candidates.sort(
      (a, b) => jobCountThatDay(a.driver_id, jobDate) - jobCountThatDay(b.driver_id, jobDate) || a.display_name.localeCompare(b.display_name)
    );
    const chosen = candidates[0];

    return {
      bookingEventId: ev.eventId,
      calendarId: 'ctt.trip365@gmail.com',
      jobDate,
      jobStartTime,
      summaryText,
      driverId: chosen.driver_id,
      driverDisplayName: chosen.display_name,
      autoConfirm: isAutoConfirmEligible(ev.eventId),
    };
  });

  await processDispatchProposals(proposals);

  const autoConfirmedCount = proposals.filter((p) => !p.noMatch && p.autoConfirm).length;
  if (autoConfirmedCount > 0) {
    // งานที่เพิ่งยืนยันอัตโนมัติต้องหายจากตัวเลือก "วันว่าง" ของคนขับคนอื่นทันที ไม่ใช่รอ cache 60 วิ
    await Promise.all(monthsInRollingRange().map((m) => invalidateJobsCache(m)));
  }

  const result = {
    proposed: proposals.filter((p) => !p.noMatch).length,
    noMatch: proposals.filter((p) => p.noMatch).length,
  };
  log.info('dispatch_match.done', { ...result, autoConfirmedCount });
  return result;
}
