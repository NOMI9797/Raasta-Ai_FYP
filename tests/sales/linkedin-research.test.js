// Reading LinkedIn profiles with the connected account (libs/sales/linkedin-research.js): the pieces
// that don't need a browser. Values are from the live read of 9 Oct 2026 (LinkedIn's new layout).
import { test } from "node:test";
import assert from "node:assert/strict";
import { countOf, monthDayDate, postDate, postRows, profileLink } from "../../libs/sales/linkedin-research";

test("profile links are cleaned (the pasted lead had ?isSelfProfile=true)", () => {
  assert.equal(profileLink("https://www.linkedin.com/in/nouman-ahmed-1843b6276/?isSelfProfile=true"), "https://www.linkedin.com/in/nouman-ahmed-1843b6276");
  assert.equal(profileLink("https://pk.linkedin.com/in/sara-ahmed#about"), "https://www.linkedin.com/in/sara-ahmed");
  assert.equal(profileLink("https://www.linkedin.com/company/syntax"), null, "a company page isn't a profile");
  assert.equal(profileLink(""), null);
});

test("reaction and comment counts as LinkedIn shows them", () => {
  assert.equal(countOf("58"), 58);
  assert.equal(countOf("1,234"), 1234);
  assert.equal(countOf("1.2K"), 1200);
  assert.equal(countOf("12 comments"), 12);
  assert.equal(countOf(undefined), 0);
});

test("post dates: 'Jun 19', 'Dec 21, 2025', relative '2w', ISO; unknown is now", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  assert.equal(monthDayDate("Jun 19", now).getFullYear(), 2026);
  assert.equal(monthDayDate("Nov 30", now).getFullYear(), 2025, "a day later in the year than today is last year's");
  assert.equal(monthDayDate("Dec 21, 2025", now).getMonth(), 11);
  assert.equal(postDate("2w", now).toISOString().slice(0, 10), "2026-09-25");
  assert.equal(postDate("2026-01-02T00:00:00Z", now).toISOString().slice(0, 10), "2026-01-02");
  assert.equal(postDate("???", now), now);
});

test("scraped posts become post rows; empty ones are dropped", () => {
  const rows = postRows([
    { text: "You vibe-coded an app. But is it ready to actually charge people?", timestamp: "Jun 19", likes: "58", comments: "3" },
    { text: "   ", timestamp: "Jun 1", likes: "1" },
  ], { userId: "u", leadId: "l", now: new Date("2026-10-09T12:00:00Z") });
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].likes, rows[0].comments, rows[0].engagement, rows[0].userId, rows[0].leadId], [58, 3, 64, "u", "l"]);
});
