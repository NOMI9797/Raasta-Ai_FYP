// Calendar invite (.ics, RFC 5545) attached to a meeting confirmation, so the client can add it to
// Google Calendar, Outlook or Apple Calendar in one click. Pure; relative imports only.

const pad = (n) => String(n).padStart(2, "0");

/** 20261014T100000Z */
export function icsDate(date) {
  const d = new Date(date);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** Escape text values: backslash, semicolon, comma, newline. */
export function icsText(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines are folded at 75 octets (continuation lines start with a space). */
function fold(line) {
  const out = [];
  let rest = line;
  while (Buffer.byteLength(rest, "utf8") > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut), "utf8") > 75) cut--;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join("\r\n");
}

/**
 * VCALENDAR text for one meeting. method REQUEST for a booking or change, CANCEL to withdraw it.
 * organizer / attendee: { name, email }
 */
export function buildIcs({ uid, sequence = 0, start, end, title, description, location, organizer, attendee, method = "REQUEST", now = new Date() }) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Raasta AI//Sales Meetings//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `SEQUENCE:${sequence}`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(title)}`,
    description ? `DESCRIPTION:${icsText(description)}` : null,
    location ? `LOCATION:${icsText(location)}` : null,
    organizer?.email ? `ORGANIZER;CN=${icsText(organizer.name || organizer.email)}:mailto:${organizer.email}` : null,
    attendee?.email ? `ATTENDEE;CN=${icsText(attendee.name || attendee.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${attendee.email}` : null,
    `STATUS:${method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Reminder",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
