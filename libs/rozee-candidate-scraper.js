/**
 * Rozee.pk Scraper
 *
 * Two scraping targets:
 *
 * A) JOB LISTINGS  — searchRozeeJobs({ query, location, limit, sessionData })
 *    Scrapes the public job search page /job/jsearch/q/{query} using an
 *    authenticated session so the server-side PHP renders real job cards.
 *    Returns: [{ title, company, location, salary, url, source:'rozee' }, ...]
 *
 * B) CANDIDATE PROFILES — scrapeRozeeCandidate({ url, sessionData })
 *    Scrapes a single seeker profile page (requires employer session).
 *    Returns: { name, title, email, skills[], experience, education, profileImage, url }
 *
 * NOTE: Both features require a valid logged-in Rozee session.  The CV/talent
 * search (/cvsearch, /talent/search) is an employer-tier paid feature and is
 * NOT available with a free jobseeker account.  searchRozeeCandidates() is
 * kept as a thin alias of searchRozeeJobs() for backward compatibility.
 */

import { humanLikeDelay, launchRozeeChromium } from "./playwright-utils";

// ── Selectors validated against the live site (2026-04) ──────────────────────
// Real card structure (from live HTML inspection):
//   div.job > .jcont > .jhead > .jobt > h3.s-18 > a[href] > bdi  (title+link)
//                                         .cname > bdi > a[0]      (company)
//                                                      > a[1]      (city)
//                             .jbody > bdi                         (description)
//                      .jfooter .rz-salary                         (salary)
const JOB_SELECTORS = {
  card: "div.job",
  title: ".jobt h3 a",
  company: ".cname a:first-child",
  location: ".cname a:nth-child(2)",
  salary: ".rz-salary, .sal, .salary",
  jobLink: ".jobt h3 a",
};

const PROFILE_SELECTORS = {
  name: "h1.cname, h1, .seeker-name, .profile-name, .name",
  title: ".ctitle, .seeker-title, .current-title, .headline",
  email: "a[href^='mailto:'], .email, .contact-email",
  skillTag: ".skill-tag, .skill, .skills li, [class*='skill'] li",
  experience: ".exp-block, .experience-section, .work-exp, .exp",
  education: ".edu-block, .education-section, .edu",
  profileImage: ".profile-pic img, .avatar img, img.profile-photo, .seeker-photo img",
};

const CONFIG = {
  navTimeout: 35000,
  renderWait: 3000,       // SSR cards are in the initial HTML; brief wait covers hydration
  pageDelay: [1000, 2000],
  maxPerPage: 20,         // Rozee renders 20 cards per search page
};

// ── Shared browser helper ─────────────────────────────────────────────────────

/**
 * Launch a clean Playwright browser, restore the Rozee session via cookies,
 * and navigate to `url`. Returns { browser, context, page }.
 *
 * Using chromium.launch() + context.addCookies() is more reliable than
 * launchPersistentContext for session restoration because addInitScript runs
 * before the first navigation rather than after the context already has
 * a page in an unknown state.
 */
async function launchWithSession(sessionData) {
  return launchRozeeChromium(sessionData || {});
}

// ── A) Job Listings ───────────────────────────────────────────────────────────

function buildJobSearchUrl(query, location, offset = 0) {
  let q = encodeURIComponent((query || "").trim());
  let url = `https://www.rozee.pk/job/jsearch/q/${q}`;
  if (location) url += `/city/${encodeURIComponent(location.trim())}`;
  if (offset > 0) url += `/fpn/${offset}`;
  return url;
}

function parseJobCards(sel) {
  const cards = Array.from(document.querySelectorAll(sel.card));
  return cards.map((card) => {
    const titleEl = card.querySelector(sel.title);
    const compEl  = card.querySelector(sel.company);
    const locEl   = card.querySelector(sel.location);
    const salEl   = card.querySelector(sel.salary);
    const linkEl  = card.querySelector(sel.jobLink);

    // href may be protocol-relative (//www.rozee.pk/...) — normalise to https
    let url = linkEl?.getAttribute("href") || linkEl?.href || null;
    if (url && url.startsWith("//")) url = "https:" + url;
    // Strip UTM params to keep URLs clean
    if (url) {
      try {
        const u = new URL(url);
        ["utm_source","utm_medium","utm_content","utm_campaign"].forEach(p => u.searchParams.delete(p));
        url = u.toString();
      } catch {}
    }

    // Company name: first anchor in .cname, strip trailing comma
    const company = (compEl?.textContent?.trim() || "").replace(/,\s*$/, "").trim() || null;

    // Location: second anchor is the city. Skip if empty, starts with comma, or is just "Pakistan".
    const rawLoc = locEl?.textContent?.trim().replace(/^,\s*/, "").replace(/,\s*$/, "").trim() || null;
    const location = (rawLoc && rawLoc.toLowerCase() !== "pakistan" && rawLoc.length > 1) ? rawLoc : null;

    return {
      title:    titleEl?.textContent?.trim() || null,
      company,
      location,
      salary:   salEl?.textContent?.trim()   || null,
      url,
      source:   "rozee",
    };
  }).filter((j) => j.title || j.company);
}

/**
 * Search Rozee.pk public job listings.
 * Session is optional — the job search page renders SSR cards even for
 * unauthenticated visitors, so a logged-out/expired session still works.
 * Returns up to `limit` job cards with title, company, location, salary, url.
 */
export async function searchRozeeJobs({ query, location, sessionData, limit = 25 } = {}) {
  if (!query && !location) throw new Error("query or location is required");

  const { browser, context, page } = sessionData
    ? await launchWithSession(sessionData)
    : await launchWithSession({});
  const results = [];

  try {
    const batchSize = Math.min(limit, CONFIG.maxPerPage);
    let offset = 0;

    while (results.length < limit) {
      const url = buildJobSearchUrl(query, location, offset);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: CONFIG.navTimeout });

      // Wait briefly for any JS-driven hydration (most cards are SSR)
      await page.waitForTimeout(CONFIG.renderWait);

      const currentUrl = page.url();
      if (currentUrl.includes("site/error")) {
        throw new Error(`Rozee returned error page: ${currentUrl}`);
      }

      const batch = await page.evaluate(parseJobCards, JOB_SELECTORS);

      if (!batch.length) break; // No more results

      results.push(...batch);
      if (results.length >= limit || batch.length < batchSize) break;

      offset += batchSize;
      await humanLikeDelay(page, ...CONFIG.pageDelay);
    }

    await browser.close();
    return results.slice(0, limit);
  } catch (error) {
    await browser.close();
    throw error;
  }
}

// ── B) Candidate Profile ──────────────────────────────────────────────────────

/**
 * Scrape a single Rozee.pk seeker/candidate profile page for full detail.
 * Requires a valid session (employer or jobseeker — public profiles accessible
 * with any valid login).
 */
export async function scrapeRozeeCandidate({ url, sessionData } = {}) {
  if (!url) throw new Error("url is required");
  if (!sessionData) throw new Error("sessionData (Rozee account) is required");

  const { browser, page } = await launchWithSession(sessionData);

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: CONFIG.navTimeout });
    await page.waitForTimeout(2500);

    const currentUrl = page.url();
    if (currentUrl.includes("site/error") || currentUrl.includes("/login")) {
      throw new Error(currentUrl.includes("/login") ? "SESSION_EXPIRED" : "PROFILE_NOT_ACCESSIBLE");
    }

    const data = await page.evaluate((sel) => {
      const txt = (q) => document.querySelector(q)?.textContent?.trim() || null;
      const skills = Array.from(document.querySelectorAll(sel.skillTag))
        .map((el) => el.textContent?.trim())
        .filter(Boolean);
      const profileImage =
        document.querySelector(sel.profileImage)?.getAttribute("src") || null;
      return {
        name: txt(sel.name),
        title: txt(sel.title),
        email: txt(sel.email),
        experience: txt(sel.experience),
        education: txt(sel.education),
        profileImage,
        skills,
      };
    }, PROFILE_SELECTORS);

    await browser.close();
    return { ...data, url, source: "rozee" };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

// ── Backward-compat alias ─────────────────────────────────────────────────────
// The old `searchRozeeCandidates` was CV-search (employer-only).
// We remap it to job search so existing callers still get data.
export async function searchRozeeCandidates({ query, sessionData, limit = 20 } = {}) {
  const jobs = await searchRozeeJobs({ query, sessionData, limit });
  // Shape returned items to match the old { name, title, url, source } contract
  return jobs.map((j) => ({
    name: j.company || null,
    title: j.title  || null,
    url:   j.url    || null,
    salary: j.salary || null,
    location: j.location || null,
    source: "rozee",
  }));
}

export { JOB_SELECTORS as ROZEE_JOB_SELECTORS, PROFILE_SELECTORS as ROZEE_CANDIDATE_SELECTORS };
