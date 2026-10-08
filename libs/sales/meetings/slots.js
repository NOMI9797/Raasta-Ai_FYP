// Free meeting times from weekly working hours, in the person's own time zone, with the built-in
// Intl time zone data (no date library). Pure, so every rule is unit-tested. Relative imports only.

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const WEEKDAY_LABELS = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };

export const DEFAULT_AVAILABILITY = {
  mon: [{ start: "11:00", end: "17:00" }],
  tue: [{ start: "11:00", end: "17:00" }],
  wed: [{ start: "11:00", end: "17:00" }],
  thu: [{ start: "11:00", end: "17:00" }],
  fri: [{ start: "11:00", end: "13:00" }, { start: "15:00", end: "17:00" }],
  sat: [],
  sun: [],
};

const MINUTE = 60 * 1000;
const STEP_MINUTES = 30; // slots start on the hour and half hour

function parts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
  });
  const out = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  return {
    year: Number(out.year), month: Number(out.month), day: Number(out.day),
    hour: Number(out.hour), minute: Number(out.minute), second: Number(out.second),
    weekday: out.weekday.toLowerCase().slice(0, 3),
  };
}

export function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return Boolean(tz);
  } catch {
    return false;
  }
}

/** Minutes the zone is ahead of UTC at that instant (Karachi: 300). */
export function zoneOffsetMinutes(date, timeZone) {
  const p = parts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / MINUTE);
}

/** The instant of a wall-clock time in a zone: zonedTime("2026-10-14", "15:00", "Asia/Karachi"). */
export function zonedTime(dateStr, timeStr, timeZone) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let offset = zoneOffsetMinutes(new Date(guess), timeZone);
  let instant = guess - offset * MINUTE;
  // Across a DST change the offset at the answer can differ from the guess's: correct once
  const offset2 = zoneOffsetMinutes(new Date(instant), timeZone);
  if (offset2 !== offset) instant = guess - offset2 * MINUTE;
  return new Date(instant);
}

/** "YYYY-MM-DD" of an instant in a zone. */
export function localDate(date, timeZone) {
  const p = parts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

const weekdayOf = (dateStr) => WEEKDAYS[new Date(`${dateStr}T12:00:00Z`).getUTCDay()];
const overlaps = (a, b) => a.start < b.end && b.start < a.end;

/** Normalise working hours: valid "HH:MM" windows with start < end, per weekday. */
export function cleanAvailability(raw) {
  const out = {};
  for (const day of Object.keys(DEFAULT_AVAILABILITY)) {
    const windows = Array.isArray(raw?.[day]) ? raw[day] : [];
    out[day] = windows
      .filter((w) => /^\d{2}:\d{2}$/.test(w?.start) && /^\d{2}:\d{2}$/.test(w?.end) && w.start < w.end)
      .map((w) => ({ start: w.start, end: w.end }))
      .sort((a, b) => a.start.localeCompare(b.start));
  }
  return out;
}

/**
 * Free slots, earliest first: [{ start: Date, end: Date }].
 * busy: [{ start, end }] already booked (kept clear by bufferMinutes on both sides).
 */
export function freeSlots({
  availability = DEFAULT_AVAILABILITY, timeZone = "Asia/Karachi", meetingMinutes = 30, bufferMinutes = 15,
  minNoticeHours = 24, horizonDays = 14, busy = [], now = new Date(), limit = 200,
}) {
  const hours = cleanAvailability(availability);
  const earliest = new Date(now.getTime() + minNoticeHours * 60 * MINUTE);
  const blocked = busy.map((b) => ({
    start: new Date(new Date(b.start).getTime() - bufferMinutes * MINUTE),
    end: new Date(new Date(b.end).getTime() + bufferMinutes * MINUTE),
  }));
  const today = localDate(now, timeZone);
  const slots = [];
  for (let i = 0; i <= horizonDays && slots.length < limit; i++) {
    const day = addDays(today, i);
    for (const w of hours[weekdayOf(day)] || []) {
      const windowEnd = zonedTime(day, w.end, timeZone);
      for (let start = zonedTime(day, w.start, timeZone); start.getTime() + meetingMinutes * MINUTE <= windowEnd.getTime(); start = new Date(start.getTime() + STEP_MINUTES * MINUTE)) {
        const slot = { start, end: new Date(start.getTime() + meetingMinutes * MINUTE) };
        if (slot.start < earliest) continue;
        if (blocked.some((b) => overlaps(slot, b))) continue;
        slots.push(slot);
      }
    }
  }
  return slots.slice(0, limit);
}

/**
 * A few times to offer: spread over different days, alternating morning and afternoon, so the
 * client has a real choice. Returns up to `count` slots in time order.
 */
export function pickOffer(slots, { count = 3, timeZone = "Asia/Karachi" } = {}) {
  const byDay = new Map();
  for (const s of slots) {
    const day = localDate(s.start, timeZone);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(s);
  }
  const picks = [];
  let wantAfternoon = false;
  for (const daySlots of byDay.values()) {
    if (picks.length >= count) break;
    const pm = daySlots.filter((s) => parts(s.start, timeZone).hour >= 14);
    const am = daySlots.filter((s) => parts(s.start, timeZone).hour < 14);
    const pool = wantAfternoon ? (pm.length ? pm : am) : (am.length ? am : pm);
    // Not the very first slot of the morning: something more comfortable
    picks.push(pool[Math.min(1, pool.length - 1)]);
    wantAfternoon = !wantAfternoon;
  }
  if (picks.length < count) {
    for (const s of slots) {
      if (picks.length >= count) break;
      if (!picks.includes(s)) picks.push(s);
    }
  }
  return picks.sort((a, b) => a.start - b.start);
}

/** Is this exact time free and inside working hours? */
export function isSlotFree(start, options) {
  const minutes = options.meetingMinutes || 30;
  const wanted = new Date(start);
  const end = new Date(wanted.getTime() + minutes * MINUTE);
  const hours = cleanAvailability(options.availability || DEFAULT_AVAILABILITY);
  const tz = options.timeZone || "Asia/Karachi";
  const day = localDate(wanted, tz);
  const inHours = (hours[weekdayOf(day)] || []).some((w) => zonedTime(day, w.start, tz) <= wanted && end <= zonedTime(day, w.end, tz));
  if (!inHours) return false;
  const earliest = new Date((options.now || new Date()).getTime() + (options.minNoticeHours ?? 24) * 60 * MINUTE);
  if (wanted < earliest) return false;
  const buffer = (options.bufferMinutes ?? 15) * MINUTE;
  return !(options.busy || []).some((b) => overlaps({ start: wanted, end }, { start: new Date(new Date(b.start).getTime() - buffer), end: new Date(new Date(b.end).getTime() + buffer) }));
}

/** "Tuesday 14 October, 3:00 PM" in the zone. */
export function formatSlot(start, timeZone) {
  const d = new Date(start);
  const date = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long" }).format(d).replace(",", "");
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(d);
  return `${date}, ${time}`;
}

/** "Pakistan time (UTC+5)" — readable for someone in another country. */
export function zoneLabel(timeZone, at = new Date()) {
  const offset = zoneOffsetMinutes(at, timeZone);
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const utc = `UTC${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, "0")}` : ""}`;
  const city = String(timeZone).split("/").pop().replace(/_/g, " ");
  const country = { Karachi: "Pakistan", Dubai: "UAE", London: "UK", "New York": "US Eastern" }[city];
  return `${country || city} time (${utc})`;
}

/** The offer as lines for an email: "- Tuesday 14 October, 3:00 PM". */
export function slotLines(slots, timeZone) {
  return slots.map((s) => `- ${formatSlot(s.start, timeZone)}`).join("\n");
}
