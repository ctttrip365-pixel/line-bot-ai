// lib/calendar.ts — Google Calendar integration via Apps Script webhook
// Flow: Gemini detects confirmed booking → parse → POST to Apps Script → create event

export interface BookingDetails {
  date: string;    // DD/MM/YYYY
  time: string;    // HH:MM
  pickup: string;
  dropoff: string;
  pax: string;
  userId: string;
  amount?: string; // ราคา เป็นตัวเลข string เช่น "600"
  bookingRef?: string; // CTT-yymmdd-xxxx (Payment Link) — ใช้เป็นชื่อ/Booking No ของ event
  guestName?: string; // ชื่อที่ลูกค้ากรอกตอนจ่ายเงิน
  phone?: string; // เบอร์โทรติดต่อ (ขอในแชทก่อนจ่ายเงินทุกครั้ง)
  flight?: string; // หมายเลขเที่ยวบิน (ขอเมื่อรับจากสนามบิน) — Apps Script รับเป็นฟิลด์ flight
}

/** จุดรับเป็นสนามบินหรือไม่ (ต้องขอหมายเลขเที่ยวบินก่อนจ่ายเงิน) */
export function isAirportPickup(pickup: string): boolean {
  return /สนามบิน|airport|\b(KBV|HKT|DMK|BKK)\b/i.test(pickup);
}

/** ข้อมูลที่ต้องมีก่อนออกลิงก์ชำระเงิน (แชมป์สั่ง 8 ต.ค. 2026): เบอร์โทรลูกค้าทุกครั้ง + หมายเลขเที่ยวบินเมื่อรับจากสนามบิน */
export function missingBookingInfo(b: BookingDetails): Array<'phone' | 'flight'> {
  const missing: Array<'phone' | 'flight'> = [];
  if ((b.phone ?? '').replace(/\D/g, '').length < 8) missing.push('phone');
  if (isAirportPickup(b.pickup) && !(b.flight ?? '').trim()) missing.push('flight');
  return missing;
}

/**
 * Parse [BOOKING_CONFIRMED]...[/BOOKING_CONFIRMED] block from Gemini reply
 * Returns null if not found
 */
export function parseBookingConfirmation(
  reply: string,
  userId: string
): BookingDetails | null {
  const match = reply.match(
    /\[BOOKING_CONFIRMED\]([\s\S]*?)\[\/BOOKING_CONFIRMED\]/
  );
  if (!match) return null;

  const block = match[1];
  const get = (key: string): string => {
    const m = block.match(new RegExp(`${key}=(.+)`));
    return m ? m[1].trim() : '';
  };

  const date = get('date');
  const time = get('time');
  const pickup = get('pickup');
  const dropoff = get('dropoff');
  const pax = get('pax');
  const amount = get('amount');
  const phone = get('phone');
  const flight = get('flight');

  // Validate required fields
  if (!date || !time || !pickup || !dropoff) return null;

  return { date, time, pickup, dropoff, pax: pax || '1', userId, amount: amount || '0', phone: phone || undefined, flight: flight || undefined };
}

/**
 * POST booking details to Google Apps Script webhook → creates Calendar event
 */
export async function createCalendarEvent(
  booking: BookingDetails
): Promise<boolean> {
  const webhookUrl = process.env.CALENDAR_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn(
      JSON.stringify({ ts: new Date().toISOString(), event: 'calendar.no_webhook_url' })
    );
    return false;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking),
      signal: AbortSignal.timeout(5000),
    });

    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: 'calendar.event_created',
        status: res.status,
        userId: booking.userId,
        date: booking.date,
        time: booking.time,
      })
    );

    return res.ok;
  } catch (err) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: 'calendar.create_failed',
        err: (err as Error).message,
        userId: booking.userId,
      })
    );
    return false;
  }
}

/**
 * Strip [BOOKING_CONFIRMED]...[/BOOKING_CONFIRMED] block before sending to LINE
 */
export function cleanReply(reply: string): string {
  return reply
    .replace(/\[BOOKING_CONFIRMED\][\s\S]*?\[\/BOOKING_CONFIRMED\]\n?/, '')
    .replace(/\[HANDOFF\]/g, '')
    .trim();
}
