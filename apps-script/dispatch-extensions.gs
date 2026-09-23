/**
 * dispatch-extensions.gs — REFERENCE CODE, ยังไม่ได้ merge เข้า Apps Script จริง
 *
 * นี่ไม่ใช่ repo ของ Apps Script ตัวจริง (Apps Script อยู่ใน script.google.com ในบัญชี
 * Google ของแชมป์ ไม่ได้ผูกกับ git repo นี้) — ไฟล์นี้คือ "ของที่ต้องเพิ่มเข้าไป" ในสคริปต์
 * เดิมที่ผูกกับ env var CALENDAR_WEBHOOK_URL (ตัวที่สร้าง Calendar event ตอนลูกค้าจองผ่านแชท
 * อยู่แล้ว) — ต้องเปิด Apps Script editor จริงแล้ว "ต่อ" โค้ดนี้เข้าไป ไม่ใช่แทนที่ทั้งไฟล์
 *
 * สิ่งที่ต้องทำก่อน merge:
 *   1. เปิด Apps Script ที่ deploy เป็น CALENDAR_WEBHOOK_URL อยู่ตอนนี้ ดู doPost(e) เดิม
 *      ว่ารับ payload แบบไหน (จาก lib/calendar.ts ฝั่ง Next.js: {date,time,pickup,dropoff,
 *      pax,userId,amount} แบบไม่มี field "action" ห่อ)
 *   2. ห่อ logic เดิมทั้งหมดไว้ในเงื่อนไข "ไม่มี e.parameter.action หรือ payload ไม่มี action"
 *      (ดู handleLegacyCreate ด้านล่างเป็นตัวอย่างโครง ต้องเอา logic จริงเดิมมาใส่แทน)
 *   3. เพิ่ม CALENDAR_ID และ DRIVER_SHEET_ID ใน Script Properties (Project Settings)
 *      — CALENDAR_ID เริ่มต้นคือ 26B73A9C-4FBD-4DD7-8C28-413072C70AC5 (ตาม CTT/CLAUDE.md §8)
 *   4. Deploy > Manage deployments > แก้ deployment เดิม (อย่าสร้าง deployment ใหม่ —
 *      URL จะเปลี่ยน ต้องไปแก้ CALENDAR_WEBHOOK_URL ใน Vercel ด้วยถ้าสร้างใหม่)
 */

function doPost(e) {
  const payload = JSON.parse(e.postData.contents);

  if (!payload.action) {
    return handleLegacyCreate(payload); // ของเดิม — ห้ามแตะ logic ข้างในนี้
  }

  switch (payload.action) {
    case 'calendar_list':
      return jsonResponse(calendarList(payload.from, payload.to));
    case 'calendar_update_driver':
      return jsonResponse(calendarUpdateDriver(payload.eventId, payload.driverLine));
    case 'sheet_read':
      return jsonResponse(sheetRead(payload.tab));
    case 'sheet_append':
      return jsonResponse(sheetAppend(payload.tab, payload.row));
    case 'sheet_update':
      return jsonResponse(sheetUpdateRow(payload.tab, payload.matchColumn, payload.matchValue, payload.patch));
    case 'sheet_write_grid':
      return jsonResponse(sheetWriteGrid_(payload.tab, payload.values, payload.backgrounds));
    default:
      return jsonResponse({ ok: false, error: 'unknown action: ' + payload.action });
  }
}

function handleLegacyCreate(payload) {
  // TODO: ย้าย logic การสร้าง Calendar event ของเดิม (จาก doPost(e) ปัจจุบัน) มาไว้ตรงนี้
  // แค่ยกมาทั้งดุ้น ไม่ต้องเขียนใหม่ — โค้ดนี้เป็นแค่ placeholder กันลืมว่าต้องมี branch นี้ไว้
  throw new Error('handleLegacyCreate: ต้องย้าย logic เดิมมาใส่ตรงนี้ก่อน deploy จริง');
}

// ---------- Calendar ----------

function getCalendar_() {
  const calendarId = PropertiesService.getScriptProperties().getProperty('CALENDAR_ID');
  return CalendarApp.getCalendarById(calendarId);
}

function calendarList(fromIso, toIso, calendarId) {
  try {
    const cal = calendarId ? CalendarApp.getCalendarById(calendarId) : getCalendar_();
    const events = cal.getEvents(new Date(fromIso), new Date(toIso));
    const data = events.map((ev) => ({
      // CalendarApp คืน eventId มีหาง "@google.com" ต่อท้าย ต่างจาก REST API — ตัดออกให้ตรงกับที่
      // ฝั่ง Next.js เทียบ eventId กัน (ไม่งั้น matching ทุกจุดที่เทียบ eventId จะพลาดหมด)
      eventId: ev.getId().split('@')[0],
      summary: ev.getTitle(),
      description: ev.getDescription() || '',
      start: ev.getStartTime().toISOString(),
    }));
    return { ok: true, data: data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * เติม/แทนที่บรรทัด "Driver: ..." ท้าย description ของ event (ห้ามแตะบรรทัดอื่นที่
 * ctt-booking เขียนไว้ — Guest/From/To/Pax/Contact/Boat-Flight time/Booking No)
 * driverLine = null → ลบบรรทัด Driver: ออก (เผื่อใช้ตอน cancel)
 */
function calendarUpdateDriver(eventId, driverLine) {
  try {
    const ev = getCalendar_().getEventById(eventId);
    if (!ev) return { ok: false, error: 'event not found: ' + eventId };

    const desc = ev.getDescription() || '';
    const withoutDriverLine = desc.replace(/\nDriver:.*$/m, '').replace(/^Driver:.*\n?/m, '');
    const newDesc = driverLine ? withoutDriverLine + '\nDriver: ' + driverLine : withoutDriverLine;
    ev.setDescription(newDesc.trim());
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---------- Sheets ("CTT - Driver Roster & Dispatch") ----------

function getSheet_(tabName) {
  const sheetId = PropertiesService.getScriptProperties().getProperty('DRIVER_SHEET_ID');
  return SpreadsheetApp.openById(sheetId).getSheetByName(tabName);
}

/**
 * Google Sheets เก็บช่องที่ดูเหมือน date/time ("2026-09-24", "11:00") เป็น native Date object
 * จริงๆ เบื้องหลัง — String(dateObj) ให้ผลแบบ "Sat Dec 30 1899 11:00:00 GMT+..." (Dec 30 1899 คือ
 * epoch ภายในของ Sheets สำหรับช่อง "เวลาอย่างเดียว") ต้องเช็ค Date แล้ว format เอง ไม่งั้นทุกแท็บ
 * ที่มีคอลัมน์วันที่/เวลาจะอ่านออกมาเพี้ยน (เจอจริงกับ job_date/job_start_time ใน Assignments_Log)
 */
function formatCellValue_(v) {
  if (v === undefined || v === null || v === '') return '';
  if (Object.prototype.toString.call(v) !== '[object Date]') return String(v);
  const isTimeOnly = v.getFullYear() === 1899 && v.getMonth() === 11 && v.getDate() === 30;
  return Utilities.formatDate(v, 'Asia/Bangkok', isTimeOnly ? 'HH:mm' : 'yyyy-MM-dd');
}

function sheetRead(tabName) {
  try {
    const sheet = getSheet_(tabName);
    const values = sheet.getDataRange().getValues();
    const headers = values[0];
    const rows = values.slice(1).map((row) => {
      const obj = {};
      headers.forEach((h, i) => (obj[h] = formatCellValue_(row[i])));
      return obj;
    });
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * เขียนทับทั้งแท็บด้วยตาราง 2 มิติดิบๆ (สร้างแท็บใหม่ถ้ายังไม่มี) — ใช้กับแท็บสรุปรายเดือน
 * ที่แชมป์อ่านเอง (เช่น "2026-10") ไม่ใช่ข้อมูลที่ระบบอ่านกลับ
 * `backgrounds` (optional) ต้องมีมิติเท่า values เป๊ะ — ช่องไหน null ปล่อยเป็นสีที่ clear() ทำไว้ (ขาว)
 */
function sheetWriteGrid_(tabName, values, backgrounds) {
  try {
    const sheetId = PropertiesService.getScriptProperties().getProperty('DRIVER_SHEET_ID');
    const ss = SpreadsheetApp.openById(sheetId);
    let sheet = ss.getSheetByName(tabName);
    if (!sheet) sheet = ss.insertSheet(tabName);
    sheet.clear();
    const range = sheet.getRange(1, 1, values.length, values[0].length);
    range.setValues(values);
    if (backgrounds) range.setBackgrounds(backgrounds);
    // 3 แถวหัว (วันในสัปดาห์/เลขวัน/Available) + กันชนไว้ให้คนขับเพิ่มได้ถึง ~9 คนโดยไม่ต้องมาขยับ freeze เอง
    sheet.setFrozenRows(12);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function sheetAppend(tabName, row) {
  try {
    const sheet = getSheet_(tabName);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const values = headers.map((h) => (row[h] !== undefined ? row[h] : ''));
    sheet.appendRow(values);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function sheetUpdateRow(tabName, matchColumn, matchValue, patch) {
  try {
    const sheet = getSheet_(tabName);
    const values = sheet.getDataRange().getValues();
    const headers = values[0];
    const matchColIdx = headers.indexOf(matchColumn);
    if (matchColIdx === -1) return { ok: false, error: 'column not found: ' + matchColumn };

    for (let r = 1; r < values.length; r++) {
      if (String(values[r][matchColIdx]) === String(matchValue)) {
        Object.keys(patch).forEach((key) => {
          const colIdx = headers.indexOf(key);
          if (colIdx !== -1) sheet.getRange(r + 1, colIdx + 1).setValue(patch[key]);
        });
        return { ok: true };
      }
    }
    return { ok: false, error: 'row not found: ' + matchColumn + '=' + matchValue };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
