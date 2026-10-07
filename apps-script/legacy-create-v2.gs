// ============================================================
// handleLegacyCreate_ เวอร์ชัน v2 — วางแทนฟังก์ชัน handleLegacyCreate_ เดิมใน Apps Script (script.google.com)
// แล้ว Deploy → Manage deployments → Edit → New version (URL เดิม ไม่ต้องเปลี่ยน env)
//
// ต่างจากเดิมอย่างเดียว: ชื่อ/คำอธิบายของ event ใช้รูปแบบมาตรฐาน CTT
//   ชื่อ:  CTT-261007-0BF6 | ชื่อลูกค้า | จุดรับ→จุดส่ง | 2 Pax | 10:00 | เบอร์
//   คำอธิบาย: Guest/From/To/Pax/Contact/Boat-Flight time/Booking No (ที่ระบบคนขับ, ข้อความแจ้งคนขับ, make-bill อ่านได้)
// ถ้า request ไม่มี bookingRef/guestName/phone (เช่นบอทเวอร์ชันเก่า) จะ fallback เป็นค่าเดิมที่ใกล้เคียงที่สุด
// ส่วนการแปลงวันที่/เวลา, ระยะเวลา 90 นาที, สีส้ม ไม่แตะ
// ============================================================
function handleLegacyCreate_(data) {
  try {
    var date = data.date;
    var time = data.time;
    var pickup = data.pickup;
    var dropoff = data.dropoff;
    var pax = data.pax || '1';
    var userId = data.userId || 'LINE User';

    var parts = date.split('/');
    var timeParts = time.split(':');
    var day = parseInt(parts[0]);
    var month = parseInt(parts[1]) - 1;
    var year = parseInt(parts[2]);
    var hour = parseInt(timeParts[0]);
    var minute = parseInt(timeParts[1] || '0');

    var startTime = new Date(year, month, day, hour, minute);
    var endTime = new Date(startTime.getTime() + 90 * 60 * 1000);

    var ref = data.bookingRef || 'LINE';
    var guest = data.guestName || 'ลูกค้า LINE';
    var phone = data.phone || '';
    var hhmm = ('0' + hour).slice(-2) + ':' + ('0' + minute).slice(-2);

    var title = [ref, guest, pickup + '→' + dropoff, pax + ' Pax', hhmm, phone]
      .filter(function (x) { return x !== ''; })
      .join(' | ');

    var description = [
      'Guest: ' + guest,
      'From: ' + pickup,
      'To: ' + dropoff,
      'Pax: ' + pax,
      'Contact: ' + (phone || 'LINE User ' + userId),
      'Boat/Flight time: ' + hhmm,
      'Booking No: ' + ref,
      '',
      'จองผ่าน LINE Bot อัตโนมัติ (ชำระเงินแล้ว)'
    ].join('\n');

    var calendar = CalendarApp.getCalendarById(CALENDAR_ID);
    var event = calendar.createEvent(title, startTime, endTime, {
      description: description,
      color: CalendarApp.EventColor.ORANGE
    });

    Logger.log('Event created: ' + event.getId());

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, eventId: event.getId() }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    Logger.log('Error: ' + err.message);
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
