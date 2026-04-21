/**
 * Rozee.pk Job Scraper
 *
 * Scrapes job listings from Rozee.pk search results using an authenticated
 * Playwright session. Selectors are centralised at the top so they can be
 * tweaked when Rozee changes its DOM without touching call sites.
 */

import { DEFAULT_BROWSER_ARGS, restoreSessionToContext, humanLikeDelay } from "./playwright-utils";

// ─── Selectors (TODO: validate against live site, update as needed) ───
export const ROZEE_JOB_SELECTORS = {
  listContainer: ".job-listing, .jhead, .job",
  title: ".job-title, h3 a, .jobt a",
  company: ".company-name, .cname, .com",
  location: ".location, .jloc",
  salary: ".salary, .jsal",
  link: "a",
  postedDate: ".posted, .jpost",
  description: ".jdesc, .job-description",
};

const SCRAPE_CONFIG = {
  navigationTimeout: 30000,
  listTimeout: 15000,
  scrollDelay: 1500,
  maxJobsPerQuery: 50,
};

function buildSearchUrl(query, page = 1) {
  const q = encodeURIComponent(query || "");
  if (page > 1) {
    return `https://www.rozee.pk/job/jsearch/q/${q}/fpn/${(page - 1) * 20}`;
  }
  return `https://www.rozee.pk/job/jsearch/q/${q}`;
}

/**
 * Scrape Rozee.pk jobs for a query. Optionally pass an existing Playwright
 * `page` (when chained from the validator) to reuse the authenticated context.
 */
export async function scrapeRozeeJobs({ query, sessionData, page: existingPage, limit = 20 } = {}) {
  if (!query) throw new Error("query is required");

  let context = null;
  let page = existingPage;
  let ownsBrowser = false;

  try {
    if (!page) {
      const { chromium } = await import("playwright");
      context = await chromium.launchPersistentContext(
        `/tmp/rozee-scrape-${Date.now()}`,
        {
          headless: true,
          viewport: { width: 1280, height: 800 },
          args: DEFAULT_BROWSER_ARGS,
        }
      );
      page = context.pages()[0] || (await context.newPage());
      ownsBrowser = true;
      if (sessionData) {
        await restoreSessionToContext(context, page, sessionData);
      }
    }

    const url = buildSearchUrl(query);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: SCRAPE_CONFIG.navigationTimeout });
    await humanLikeDelay(page, 1500, 2500);

    try {
      await page.waitForSelector(ROZEE_JOB_SELECTORS.listContainer, { timeout: SCRAPE_CONFIG.listTimeout });
    } catch {
      // list selector didn't appear — return empty rather than crashing
      if (ownsBrowser && context) await context.close();
      return [];
    }

    const jobs = await page.evaluate(
      (sel, max) => {
        const cards = Array.from(document.querySelectorAll(sel.listContainer)).slice(0, max);
        return cards.map((card) => {
          const text = (q) => card.querySelector(q)?.textContent?.trim() || null;
          const link = card.querySelector(sel.link);
          return {
            title: text(sel.title),
            company: text(sel.company),
            location: text(sel.location),
            salary: text(sel.salary),
            postedDate: text(sel.postedDate),
            description: text(sel.description),
            url: link?.href || null,
            source: "rozee",
          };
        });
      },
      ROZEE_JOB_SELECTORS,
      Math.min(limit, SCRAPE_CONFIG.maxJobsPerQuery)
    );

    if (ownsBrowser && context) await context.close();
    return jobs.filter((j) => j.title || j.url);
  } catch (error) {
    if (ownsBrowser && context) await context.close();
    throw error;
  }
}

/**
 * Scrape a single job detail page for richer fields (description, requirements).
 */
export async function scrapeRozeeJobDetail({ url, sessionData, page: existingPage } = {}) {
  if (!url) throw new Error("url is required");

  let context = null;
  let page = existingPage;
  let ownsBrowser = false;

  try {
    if (!page) {
      const { chromium } = await import("playwright");
      context = await chromium.launchPersistentContext(
        `/tmp/rozee-job-detail-${Date.now()}`,
        { headless: true, viewport: { width: 1280, height: 800 }, args: DEFAULT_BROWSER_ARGS }
      );
      page = context.pages()[0] || (await context.newPage());
      ownsBrowser = true;
      if (sessionData) await restoreSessionToContext(context, page, sessionData);
    }

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: SCRAPE_CONFIG.navigationTimeout });
    await humanLikeDelay(page, 1000, 2000);

    const detail = await page.evaluate(() => {
      const txt = (q) => document.querySelector(q)?.textContent?.trim() || null;
      return {
        title: txt("h1, .job-title"),
        company: txt(".company-name, .cname"),
        location: txt(".location, .jloc"),
        salary: txt(".salary, .jsal"),
        description: txt(".jdesc, .job-description, .jbody"),
        skills: Array.from(document.querySelectorAll(".skill-tag, .skill, .skills li"))
          .map((el) => el.textContent?.trim())
          .filter(Boolean),
      };
    });

    if (ownsBrowser && context) await context.close();
    return { ...detail, url, source: "rozee" };
  } catch (error) {
    if (ownsBrowser && context) await context.close();
    throw error;
  }
}
