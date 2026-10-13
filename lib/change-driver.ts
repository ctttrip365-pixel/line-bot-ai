// lib/change-driver.ts — คำสั่งของแชมป์ใน Telegram: "เปลี่ยนคนขับ [วันที่]"
//   ไม่ระบุวัน → ถามวัน (ปุ่ม 7 วันข้างหน้า หรือพิมพ์วันที่ต่อได้เลย เช่น 15/10)
//   ระบุวัน   → ดึง booking ทั้งหมดของวันนั้นจากปฏิทิน แสดงคนขับปัจจุบัน + ปุ่มเลือกงาน
//   กดงาน → เลือกคนขับใหม่ (callback `reassign:` เดิม) → ยืนยัน (callback `confirm_assign:` เดิม)

import { listCalendarEvents, isBookingEvent } from './gas-client';
import { listAssignmentsStrict } from './assignments';
import { listDrivers } from './drivers';
import { sendTelegramMessage, type InlineButton } from './telegram';
import { getRedis } from './history';
import { toBangkokParts } from './date-range';
import { parseThaiDate, bangkokToday, addDaysYmd, dayLabel } from './thai-date';
import { log } from './log';

const WAIT_KEY = 'champ:cd_wait';
const WAIT_TTL_SECONDS = 5 * 60;
const CHUNK = 10;

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function askDay(): Promise<void> {
  try {
    await getRedis().set(WAIT_KEY, '1', { ex: WAIT_TTL_SECONDS });
  } catch (err) {
    log.warn('change_driver.wait_flag_failed', { err: (err as Error).message });
  }
  const today = bangkokToday();
  const days = Array.from({ length: 7 }, (_, i) => addDaysYmd(today, i));
  const buttons: InlineButton[][] = [];
  for (let i = 0; i < days.length; i += 2) {
    buttons.push(
      days.slice(i, i + 2).map((d, j) => ({
        text: `${i + j === 0 ? 'วันนี้ ' : i + j === 1 ? 'พรุ่งนี้ ' : ''}${dayLabel(d)}`,
        callback_data: `cd_day:${d}`,
      }))
    );
  }
  await sendTelegramMessage(
    '📅 <b>เปลี่ยนคนขับ — งานวันไหนครับ?</b>\nกดวัน หรือพิมพ์วันที่ได้เลย เช่น <code>15/10</code>, <code>พรุ่งนี้</code>, <code>20 ต.ค.</code>',
    buttons
  );
}

/** ดึง booking ทั้งหมดของวัน (ตามปฏิทิน) พร้อมคนขับปัจจุบัน แล้วส่งปุ่มให้แชมป์เลือกงาน */
export async function sendDayBookings(ymd: string): Promise<void> {
  await sendTelegramMessage(`⏳ กำลังดึงงานวันที่ ${ymd}... (ถ้า Apps Script ช้าอาจใช้เวลาครึ่งนาที)`);

  const [cal, assignments, drivers] = await Promise.all([
    listCalendarEvents(`${ymd}T00:00:00+07:00`, `${ymd}T23:59:59+07:00`),
    listAssignmentsStrict(),
    listDrivers(),
  ]);
  if (!cal.ok || !cal.data) throw new Error('calendar_read_failed');

  const latest = new Map<string, { driver_id: string; status: string }>();
  for (const a of assignments) latest.set(a.booking_event_id, { driver_id: a.driver_id, status: a.status });
  const nameOf = (id: string) => drivers.find((d) => d.driver_id === id)?.display_name ?? id;

  const jobs = cal.data
    .filter(isBookingEvent)
    .filter((ev) => toBangkokParts(ev.start).date === ymd) // กันงานข้ามวันที่หลุดเข้ามาจากขอบช่วงเวลา
    .map((ev) => {
      const row = latest.get(ev.eventId);
      let driver = '';
      if (row && (row.status === 'confirmed' || row.status === 'notified' || row.status === 'proposed')) driver = nameOf(row.driver_id);
      else {
        const m = (ev.description || '').match(/^Driver:\s*(.+)$/m); // ลงชื่อคนขับในปฏิทินเอง (ไม่มีแถวในชีต)
        if (m) driver = m[1].replace(/\s*\(.*\)\s*$/, '').trim();
      }
      return { ev, time: toBangkokParts(ev.start).time, driver, status: row?.status };
    })
    .sort((a, b) => a.time.localeCompare(b.time));

  if (jobs.length === 0) {
    await sendTelegramMessage(`วันที่ ${ymd} (${dayLabel(ymd)}) ไม่มีงาน (booking) ในปฏิทินครับ`);
    return;
  }

  const lines = jobs.map(
    (j, i) =>
      `${i + 1}. ${j.time} — ${esc(j.ev.summary.split('|').slice(0, 3).join('|').trim())}\n    คนขับ: ${j.driver ? esc(j.driver) : '— ยังไม่มี'}${j.status === 'cancelled' ? ' (ยกเลิกแล้ว)' : ''}`
  );
  const buttons: InlineButton[][] = jobs.map((j, i) => [
    { text: `🔄 ${i + 1}. ${j.time} ${j.driver || '(ยังไม่มีคนขับ)'}`, callback_data: `reassign:${j.ev.eventId}` },
  ]);

  const total = Math.ceil(jobs.length / CHUNK);
  for (let i = 0; i < jobs.length; i += CHUNK) {
    const n = i / CHUNK + 1;
    await sendTelegramMessage(
      [`📅 <b>งานวันที่ ${ymd} (${dayLabel(ymd)}) — ${jobs.length} งาน</b>${total > 1 ? ` ชุด ${n}/${total}` : ''}`, '', ...lines.slice(i, i + CHUNK), '', 'กดงานที่ต้องการเปลี่ยนคนขับ'].join('\n'),
      buttons.slice(i, i + CHUNK)
    );
  }
}

/** รันคำสั่ง: มีวันที่ในคำสั่ง → แสดงงาน, ไม่มี → ถามวัน; อ่านข้อมูลไม่ได้ต้องบอกว่าอ่านไม่ได้ (ไม่ใช่ "ไม่มีงาน") */
export async function runChangeDriver(arg?: string): Promise<void> {
  try {
    if (!arg || !arg.trim()) return await askDay();
    const ymd = parseThaiDate(arg);
    if (!ymd) {
      await sendTelegramMessage(`อ่านวันที่ "${esc(arg.trim())}" ไม่ออกครับ — พิมพ์เช่น 15/10, พรุ่งนี้, 20 ต.ค. หรือกดเลือกวันด้านล่าง`);
      return await askDay();
    }
    await sendDayBookings(ymd);
  } catch (err) {
    log.error('change_driver.failed', { err: (err as Error).message });
    await sendTelegramMessage('⚠️ ดึงงานของวันนั้นไม่ได้ (Apps Script ช้า/ไม่ตอบ) ลองพิมพ์ "เปลี่ยนคนขับ" อีกครั้งในอีก 1 นาทีนะครับ');
  }
}

/** แชมป์พิมพ์วันที่ตามหลังคำถาม "งานวันไหน" — ถ้าอยู่ในช่วงรอ (5 นาที) และอ่านเป็นวันที่ได้ ให้ทำต่อ คืน true = จัดการแล้ว */
export async function consumeWaitingDate(text: string): Promise<boolean> {
  let waiting = false;
  try {
    waiting = (await getRedis().get(WAIT_KEY)) !== null;
  } catch {
    return false;
  }
  if (!waiting) return false;
  const ymd = parseThaiDate(text);
  if (!ymd) return false; // ไม่ใช่วันที่ → ปล่อยให้ข้อความไปทางปกติ (เช่น เป็นใบจองของเพื่อน)
  try {
    await getRedis().del(WAIT_KEY);
  } catch {
    /* ไม่สำคัญ */
  }
  await runChangeDriver(text);
  return true;
}

export async function handleChangeDriverDay(ymd: string): Promise<void> {
  try {
    await getRedis().del(WAIT_KEY);
  } catch {
    /* ไม่สำคัญ */
  }
  try {
    await sendDayBookings(ymd);
  } catch (err) {
    log.error('change_driver.day_failed', { err: (err as Error).message });
    await sendTelegramMessage('⚠️ ดึงงานของวันนั้นไม่ได้ (Apps Script ช้า/ไม่ตอบ) ลองกดอีกครั้งในอีก 1 นาทีนะครับ');
  }
}
