// lib/booking-parse.ts — parses the structured description block `ctt-booking`
// (Claude Code skill, Agent 2) writes onto every booking Calendar event:
//   Guest: ...\nFrom: ...\nTo: ...\nPax: ...\nContact: ...\nBoat/Flight time: ...\nBooking No: ...
// Read-only parsing here — this file must never be the thing that WRITES that format,
// `ctt-booking` owns it.

export interface ParsedBooking {
  guest: string;
  from: string;
  to: string;
  pax: string;
  contact: string;
  pickupTime: string;
  bookingNo: string;
}

function extract(description: string, label: string): string {
  const m = description.match(new RegExp(`${label}:\\s*(.+)`));
  return m ? m[1].trim() : '';
}

export function parseBookingDescription(description: string): ParsedBooking {
  return {
    guest: extract(description, 'Guest'),
    from: extract(description, 'From'),
    to: extract(description, 'To'),
    pax: extract(description, 'Pax'),
    contact: extract(description, 'Contact'),
    pickupTime: extract(description, 'Boat/Flight time'),
    bookingNo: extract(description, 'Booking No'),
  };
}
