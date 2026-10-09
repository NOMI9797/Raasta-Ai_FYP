// Reading LinkedIn profiles for the sales agent, through the connected LinkedIn account: the saved
// session cookies open a logged-in browser (Playwright), each profile's name and headline are read and
// its recent posts are scraped with the existing scraper (libs/linkedin-post-scraper.js). Posts go to
// the posts table and the lead is marked read ("completed"), so it can be scored and written to.
// Slow, human-like pacing and a small daily limit keep the account safe. Relative imports only.
import { eq } from "drizzle-orm";
import { db } from "../db";
import { leads, posts } from "../schema";
import { linkedinAdapter } from "../platforms/linkedin";
import { scrapeProfilePosts } from "../linkedin-post-scraper";
import { profileLink } from "./contact-route";

export { profileLink };

export const PROFILE_READS_PER_DAY = 15;
const PAUSE_MS = { min: 6000, max: 14000 }; // between profiles, like a person browsing

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const between = ({ min, max }) => min + Math.floor(Math.random() * (max - min));

/** "1,234" / "12 comments" / "1.2K" → a number. */
export function countOf(text) {
  const m = String(text ?? "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([km])?/i);
  if (!m) return 0;
  const n = Number(m[1]) * (m[2]?.toLowerCase() === "k" ? 1000 : m[2]?.toLowerCase() === "m" ? 1000000 : 1);
  return Math.round(n);
}

/** A post's date: an ISO datetime, or LinkedIn's relative "3d" / "2w" / "5mo" / "1yr", else now. */
export function postDate(value, now = new Date()) {
  const shown = monthDayDate(value, now);
  if (shown) return shown;
  const iso = new Date(value);
  if (value && /\d{4}-\d{2}-\d{2}/.test(String(value)) && !Number.isNaN(iso.getTime())) return iso;
  const m = String(value || "").trim().match(/^(\d+)\s*(s|m|h|d|w|mo|yr|y)\b/i);
  if (!m) return now;
  const n = Number(m[1]);
  const unit = { s: 1, m: 60, h: 3600, d: 86400, w: 604800, mo: 2592000, yr: 31536000, y: 31536000 }[m[2].toLowerCase()];
  return new Date(now.getTime() - n * unit * 1000);
}

/** Scraped posts → rows for the posts table (empty texts dropped). */
export function postRows(scraped, { userId, leadId, now = new Date() }) {
  return (scraped || [])
    .filter((p) => String(p.text || "").trim())
    .map((p) => {
      const likes = countOf(p.likes);
      const comments = countOf(p.comments);
      return {
        userId, leadId,
        content: String(p.text).trim().slice(0, 5000),
        timestamp: postDate(p.timestamp, now),
        likes, comments, shares: 0,
        engagement: likes + comments * 2,
      };
    });
}

// Code run inside the LinkedIn page is passed as text: the worker runs under tsx, whose helpers
// (__name) don't exist in the browser. LinkedIn's 2026 layout has random class names and no <h1>,
// so these read stable things: the page title, headings' text, data-testid and aria-label.

// Name from the title ("Nouman Ahmed | LinkedIn"); headline and location from the lines after the name
const PROFILE_HEADER = `(() => {
  var name = document.title.replace(/\\s*\\|\\s*LinkedIn.*$/i, "").replace(/^\\(\\d+\\)\\s*/, "").trim();
  var signedOut = /sign in|join linkedin|log in/i.test(document.title) || window.location.pathname.indexOf("/authwall") === 0 || window.location.pathname.indexOf("/login") === 0;
  var main = document.querySelector("main") || document.body;
  var lines = main.innerText.split("\\n").map(function (l) { return l.trim(); }).filter(Boolean);
  var at = lines.indexOf(name);
  var after = at >= 0 ? lines.slice(at + 1, at + 14) : [];
  var skip = /^(·|•|\\d+(st|nd|rd|th)\\+?$|\\d+(st|nd|rd|th)|he\\/|she\\/|they\\/|verified|contact info|followers?|connections?|\\d[\\d,+]* (followers|connections))/i;
  var headline = after.find(function (l) { return l.length > 3 && !skip.test(l) && l !== name; }) || null;
  var ci = after.indexOf("Contact info");
  var place = ci > 0 ? after[ci - 1].replace(/\\s*·\\s*$/, "") : null;
  if (place === headline || !place) place = null;
  return { name: signedOut ? null : (name || null), headline: headline, location: place, signedOut: signedOut };
})()`;

// Posts on the activity page: each is a block whose heading reads "Feed post"
const ACTIVITY_POSTS = `((max) => {
  var heads = Array.from(document.querySelectorAll("h2")).filter(function (h) { return h.innerText.trim() === "Feed post"; });
  var out = [];
  heads.slice(0, max).forEach(function (h) {
    var box = h.parentElement;
    if (!box) return;
    var textEl = box.querySelector('[data-testid="expandable-text-box"]');
    var text = textEl ? textEl.innerText.replace(/\\s*…\\s*more\\s*$/i, "").trim() : "";
    // Counts and dates can sit in text LinkedIn hides visually: read textContent, not innerText
    var leaves = Array.from(box.querySelectorAll("span, p, a, time")).filter(function (e) { return e.children.length === 0; }).map(function (e) { return (e.textContent || "").replace(/\\s+/g, " ").trim(); });
    var dateRe = /^([A-Z][a-z]{2} \\d{1,2}(, \\d{4})?|\\d+\\s*(s|m|h|d|w|mo|yr|y))(\\s*[•·].*)?$/;
    var dateText = leaves.find(function (t) { return dateRe.test(t); }) || null;
    var date = dateText ? dateText.replace(/\\s*[•·].*$/, "") : null;
    var all = (box.textContent || "").replace(/\\s+/g, " ");
    var reactions = (all.match(/([\\d,.]+[KkMm]?)\\s+reactions?/) || [])[1] || "0";
    var comments = (all.match(/([\\d,.]+[KkMm]?)\\s+comments?/) || [])[1] || "0";
    out.push({ text: text, timestamp: date, likes: reactions, comments: comments, repost: /reposted this/.test(all.slice(0, 400)) });
  });
  return out;
})`;

/** Name, headline and location from an open profile page. */
async function readProfileHeader(page, profileUrl) {
  await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(between({ min: 3000, max: 5000 }));
  return page.evaluate(PROFILE_HEADER);
}

/** Recent posts from the profile's activity page (new layout), scrolling a little like a person. */
async function readActivityPosts(page, profileUrl, maxPosts) {
  await page.goto(`${profileUrl}/recent-activity/all/`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(between({ min: 4000, max: 6000 }));
  for (let i = 0; i < 2; i++) {
    await page.mouse.wheel(0, 900 + Math.floor(Math.random() * 400));
    await page.waitForTimeout(between({ min: 1500, max: 2500 }));
  }
  return page.evaluate(`${ACTIVITY_POSTS}(${Number(maxPosts) || 5})`);
}

/** "Jun 19" (this year, or last year if that's in the future) / "Dec 21, 2025" → a date. */
export function monthDayDate(value, now = new Date()) {
  const m = String(value || "").match(/^([A-Z][a-z]{2}) (\d{1,2})(?:, (\d{4}))?$/);
  if (!m) return null;
  const year = m[3] ? Number(m[3]) : now.getFullYear();
  let d = new Date(`${m[1]} ${m[2]}, ${year} 12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  if (!m[3] && d > now) d = new Date(`${m[1]} ${m[2]}, ${year - 1} 12:00:00`);
  return d;
}

/**
 * Read LinkedIn profiles with the connected account, one browser session for the batch.
 * @param {object} account the connected LinkedIn account
 * @param {object[]} people leads (source linkedin) with a profile url
 * @returns {Promise<{ leadId, ok, posts?, name?, headline?, error? }[]>}
 */
export async function readLinkedInProfiles(account, people, { database = db, maxPosts = 5, sleep = pause } = {}) {
  if (!people.length) return [];
  const session = await linkedinAdapter.testSession(account, true);
  if (!session?.isValid) throw new Error(`LinkedIn session invalid: ${session?.reason || "sign in again on Platforms"}`);
  const results = [];
  try {
    for (const [i, lead] of people.entries()) {
      if (i > 0) await sleep(between(PAUSE_MS));
      try {
        const profileUrl = profileLink(lead.url);
        if (!profileUrl) throw new Error("This lead has no LinkedIn profile link");
        const header = await readProfileHeader(session.page, profileUrl);
        if (header.signedOut) throw new Error("LinkedIn signed the account out: reconnect it on Platforms");
        if (!header.name) throw new Error("The profile didn't load (it may be private or the link is wrong)");
        // The current layout first; the older scraper for LinkedIn's previous layout as a fallback
        let scraped = await readActivityPosts(session.page, profileUrl, maxPosts).catch(() => []);
        if (!scraped.length) scraped = (await scrapeProfilePosts(session.page, profileUrl, { maxPosts, scrollAttempts: 2 })).posts || [];
        const rows = postRows(scraped, { userId: lead.userId, leadId: lead.id });

        await database.delete(posts).where(eq(posts.leadId, lead.id));
        if (rows.length) await database.insert(posts).values(rows);
        await database.update(leads).set({
          name: lead.name || header.name,
          title: lead.title || header.headline,
          status: "completed",
          sourceData: {
            ...(lead.sourceData || {}),
            profile: { name: header.name, headline: header.headline, location: header.location, posts: rows.length, readAt: new Date().toISOString(), readWith: "linkedin account" },
          },
          updatedAt: new Date(),
        }).where(eq(leads.id, lead.id));
        results.push({ leadId: lead.id, ok: true, posts: rows.length, name: header.name, headline: header.headline });
      } catch (error) {
        results.push({ leadId: lead.id, ok: false, error: error.message });
      }
    }
  } finally {
    await linkedinAdapter.cleanupSession(session.context);
  }
  return results;
}
