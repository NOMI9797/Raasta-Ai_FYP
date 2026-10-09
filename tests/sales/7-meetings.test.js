// Meetings (step 7): free times, calendar invites and meeting settings.
// Combined from the section's test files; each keeps its own setup inside its describe block.
// Run: npm run test:sales:meetings   (or: npx tsx --test tests/sales/7-meetings.test.js)
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildIcs, icsDate, icsText } from "../../libs/sales/meetings/ics";
import { cleanSettings } from "../../libs/sales/meetings/settings";
import { cleanAvailability, DEFAULT_AVAILABILITY, formatSlot, freeSlots, isSlotFree, localDate, pickOffer, zonedTime, zoneLabel, zoneOffsetMinutes } from "../../libs/sales/meetings/slots";

// ─── Meetings (was meetings.test.js) ───
describe("Meetings", () => {
  const KHI = "Asia/Karachi";
  // Monday 12 October 2026, 09:00 in Karachi
  const monday9 = new Date("2026-10-12T04:00:00Z");

  test("wall-clock times convert to instants in any zone, across DST", () => {
    assert.equal(zonedTime("2026-10-14", "15:00", KHI).toISOString(), "2026-10-14T10:00:00.000Z");
    assert.equal(zonedTime("2026-07-01", "09:00", "Europe/London").toISOString(), "2026-07-01T08:00:00.000Z");
    assert.equal(zonedTime("2026-12-01", "09:00", "Europe/London").toISOString(), "2026-12-01T09:00:00.000Z");
    assert.equal(zonedTime("2026-07-01", "09:00", "America/New_York").toISOString(), "2026-07-01T13:00:00.000Z");
    assert.equal(zoneOffsetMinutes(new Date(), KHI), 300);
    assert.equal(localDate(new Date("2026-10-12T20:00:00Z"), KHI), "2026-10-13");
  });

  test("free slots respect working hours, notice and the horizon", () => {
    const slots = freeSlots({ availability: DEFAULT_AVAILABILITY, timeZone: KHI, meetingMinutes: 30, minNoticeHours: 24, horizonDays: 7, now: monday9 });
    assert.ok(slots.length > 20);
    // Nothing within 24 hours: the first slot is Tuesday 11:00 Karachi
    assert.equal(slots[0].start.toISOString(), "2026-10-13T06:00:00.000Z");
    for (const s of slots) {
      const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: KHI, hour: "numeric", hourCycle: "h23" }).format(s.start));
      assert.ok(hour >= 11 && hour < 17, `outside hours: ${s.start.toISOString()}`);
      const day = new Intl.DateTimeFormat("en-US", { timeZone: KHI, weekday: "short" }).format(s.start);
      assert.ok(!["Sat", "Sun"].includes(day));
      assert.equal(s.end - s.start, 30 * 60 * 1000);
    }
    // Friday's lunch break (13:00-15:00) has no slots
    const fridayLunch = slots.filter((s) => localDate(s.start, KHI) === "2026-10-16" && s.start >= zonedTime("2026-10-16", "13:00", KHI) && s.start < zonedTime("2026-10-16", "15:00", KHI));
    assert.equal(fridayLunch.length, 0);
  });

  test("booked meetings and their buffer are kept free", () => {
    const busy = [{ start: zonedTime("2026-10-13", "12:00", KHI), end: zonedTime("2026-10-13", "12:30", KHI) }];
    const slots = freeSlots({ timeZone: KHI, busy, bufferMinutes: 15, now: monday9, horizonDays: 1 });
    const tuesday = slots.filter((s) => localDate(s.start, KHI) === "2026-10-13").map((s) => formatSlot(s.start, KHI).split(", ")[1]);
    assert.ok(!tuesday.includes("11:30 AM")); // would end at 12:00, inside the 15-minute buffer
    assert.ok(!tuesday.includes("12:00 PM"));
    assert.ok(!tuesday.includes("12:30 PM")); // starts inside the buffer after
    assert.ok(tuesday.includes("11:00 AM"));
    assert.ok(tuesday.includes("1:00 PM"));
  });

  test("the offer spreads three times over different days, morning and afternoon", () => {
    const slots = freeSlots({ timeZone: KHI, now: monday9, horizonDays: 10 });
    const offer = pickOffer(slots, { count: 3, timeZone: KHI });
    assert.equal(offer.length, 3);
    assert.equal(new Set(offer.map((s) => localDate(s.start, KHI))).size, 3);
    const hours = offer.map((s) => Number(new Intl.DateTimeFormat("en-US", { timeZone: KHI, hour: "numeric", hourCycle: "h23" }).format(s.start)));
    assert.ok(hours.some((h) => h < 14) && hours.some((h) => h >= 14));
    assert.deepEqual([...offer].sort((a, b) => a.start - b.start), offer);
  });

  test("a specific time is free only inside hours, after the notice, away from bookings", () => {
    const options = { availability: DEFAULT_AVAILABILITY, timeZone: KHI, meetingMinutes: 30, minNoticeHours: 24, bufferMinutes: 15, now: monday9, busy: [] };
    assert.equal(isSlotFree(zonedTime("2026-10-14", "15:00", KHI), options), true);
    assert.equal(isSlotFree(zonedTime("2026-10-14", "16:45", KHI), options), false); // runs past 17:00
    assert.equal(isSlotFree(zonedTime("2026-10-17", "12:00", KHI), options), false); // Saturday
    assert.equal(isSlotFree(zonedTime("2026-10-12", "15:00", KHI), options), false); // under 24 hours away
    const busy = [{ start: zonedTime("2026-10-14", "15:00", KHI), end: zonedTime("2026-10-14", "15:30", KHI) }];
    assert.equal(isSlotFree(zonedTime("2026-10-14", "15:30", KHI), { ...options, busy }), false);
    assert.equal(isSlotFree(zonedTime("2026-10-14", "16:00", KHI), { ...options, busy }), true);
  });

  test("times read naturally for the client", () => {
    assert.equal(formatSlot(zonedTime("2026-10-14", "15:00", KHI), KHI), "Wednesday 14 October, 3:00 PM");
    assert.equal(zoneLabel(KHI), "Pakistan time (UTC+5)");
    assert.equal(zoneLabel("Asia/Kolkata"), "Kolkata time (UTC+5:30)");
  });

  test("working hours are cleaned: bad and backwards windows are dropped", () => {
    const out = cleanAvailability({ mon: [{ start: "09:00", end: "12:00" }, { start: "15:00", end: "14:00" }, { start: "9am", end: "5pm" }], funday: [{ start: "01:00", end: "02:00" }] });
    assert.deepEqual(out.mon, [{ start: "09:00", end: "12:00" }]);
    assert.deepEqual(out.tue, []);
    assert.equal(out.funday, undefined);
  });

  test("settings are validated with safe defaults", () => {
    const s = cleanSettings({ timezone: "Mars/Base", meetingMinutes: 500, followUpDays: [7, 3, 3, 99, -1], meetingLink: "javascript:alert(1)", companyName: "  Acme  " });
    assert.equal(s.timezone, "Asia/Karachi");
    assert.equal(s.meetingMinutes, 120);
    assert.deepEqual(s.followUpDays, [3, 7]);
    assert.equal(s.meetingLink, null);
    assert.equal(s.companyName, "Acme");
    assert.equal(cleanSettings({ meetingLink: "https://meet.google.com/abc-defg-hij" }).meetingLink, "https://meet.google.com/abc-defg-hij");
  });

  test("the calendar invite is valid iCalendar with the meeting, organiser and attendee", () => {
    const ics = buildIcs({
      uid: "u1@raasta-ai", sequence: 1, start: "2026-10-14T10:00:00Z", end: "2026-10-14T10:30:00Z",
      title: "Discovery call: Zoho, Inc.", description: "Join: https://meet.google.com/abc", location: "https://meet.google.com/abc",
      organizer: { name: "Acme", email: "sales@acme.com" }, attendee: { name: "Ali", email: "ali@zoho.com" }, now: new Date("2026-10-06T00:00:00Z"),
    });
    assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
    assert.match(ics, /METHOD:REQUEST\r\n/);
    assert.match(ics, /DTSTART:20261014T100000Z\r\n/);
    assert.match(ics, /DTEND:20261014T103000Z\r\n/);
    assert.match(ics, /SUMMARY:Discovery call: Zoho\\, Inc\.\r\n/);
    assert.match(ics, /SEQUENCE:1\r\n/);
    assert.match(ics, /ORGANIZER;CN=Acme:mailto:sales@acme.com/);
    assert.match(ics.replace(/\r\n /g, ""), /ATTENDEE;CN=Ali;.*mailto:ali@zoho.com/); // long lines are folded
    assert.ok(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75), "lines are folded");
    assert.match(buildIcs({ uid: "u", start: new Date(), end: new Date(), title: "x", method: "CANCEL" }), /STATUS:CANCELLED/);
    assert.equal(icsDate("2026-01-02T03:04:05Z"), "20260102T030405Z");
    assert.equal(icsText("a,b;c\nd\\"), "a\\,b\\;c\\nd\\\\");
  });
});
