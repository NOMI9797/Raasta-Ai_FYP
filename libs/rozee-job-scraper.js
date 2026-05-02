/**
 * Rozee.pk Job Scraper
 *
 * Scrapes job listings from Rozee.pk search results using an authenticated
 * Playwright session. Selectors are centralised at the top so they can be
 * tweaked when Rozee changes its DOM without touching call sites.
 */

import { DEFAULT_BROWSER_ARGS, restoreSessionToContext, humanLikeDelay, launchRozeeChromium } from "./playwright-utils";

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

async function scrapePublicCompanyContext(url) {
  if (!url) return null;
  console.log(`[ROZEE_COMPANY] visiting url=${url}`);

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    args: DEFAULT_BROWSER_ARGS,
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1500);

    const contextData = await page.evaluate(() => {
      const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
      const PHONE_RE = /(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{3,4}\b/g;
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const pickText = (sels) => {
        for (const sel of sels) {
          const el = document.querySelector(sel);
          const text = clean(el?.textContent || "");
          if (text.length > 6) return text;
        }
        return null;
      };

      const bodyText = clean(document.body?.innerText || "");
      const title = clean(document.title || "") || null;
      const metaDescription =
        clean(
          document
            .querySelector("meta[name='description'], meta[property='og:description']")
            ?.getAttribute("content") || ""
        ) || null;
      const h1 = pickText(["h1", "main h1", "[role='main'] h1"]);
      const aboutSnippet = pickText([
        "section#about",
        "#about",
        ".about",
        ".about-us",
        "[class*='about']",
        "main p",
      ]) || bodyText.slice(0, 1200);

      const emails = [...new Set(bodyText.match(EMAIL_RE) || [])].slice(0, 8);
      const phones = [...new Set(bodyText.match(PHONE_RE) || [])]
        .map((p) => clean(p))
        .filter((p) => p.length >= 7)
        .slice(0, 8);

      return {
        title,
        metaDescription,
        h1,
        aboutSnippet,
        emails,
        phones,
      };
    });

    return {
      url: page.url(),
      ...contextData,
      scrapedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.warn(
      `[ROZEE_COMPANY] failed url=${url} reason=${error instanceof Error ? error.message : "unknown"}`
    );
    return null;
  } finally {
    await browser.close();
  }
}

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
  console.log(`[ROZEE_JOB] detail start url=${url}`);

  let browser = null;
  let page = existingPage;
  let ownsBrowser = false;

  try {
    if (!page) {
      const launched = await launchRozeeChromium(sessionData || {});
      browser = launched.browser;
      page = launched.page;
      ownsBrowser = true;
    }

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: SCRAPE_CONFIG.navigationTimeout });
    await humanLikeDelay(page, 1500, 2500);

    const currentUrl = page.url();
    if (currentUrl.includes("site/error") || currentUrl.includes("/login")) {
      throw new Error(
        currentUrl.includes("/login") ? "SESSION_EXPIRED" : `Rozee error page: ${currentUrl}`
      );
    }

    const detail = await page.evaluate(() => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim() || null;
      const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
      const textFrom = (selectors) => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          const t = el?.textContent?.trim();
          if (t && t.length > 1) return clean(t);
        }
        return null;
      };
      const longestFrom = (selectors) => {
        let best = "";
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          const t = el?.innerText?.trim() || "";
          if (t.length > best.length) best = t;
        }
        return best ? clean(best) : null;
      };
      const normalizeHref = (href) => {
        if (!href) return null;
        try {
          if (href.startsWith("//")) return `https:${href}`;
          if (href.startsWith("/")) return new URL(href, window.location.origin).toString();
          return new URL(href).toString();
        } catch {
          return null;
        }
      };
      const allAnchors = Array.from(document.querySelectorAll("a[href]"))
        .map((a) => normalizeHref(a.getAttribute("href") || a.href))
        .filter(Boolean);
      const uniqueAnchors = [...new Set(allAnchors)];
      const socialLinks = uniqueAnchors.filter((u) =>
        /(linkedin\.com|github\.com|facebook\.com|twitter\.com|x\.com|instagram\.com)/i.test(u)
      );
      const companyLinks = uniqueAnchors.filter((u) =>
        !/rozee\.pk/i.test(u) && /^https?:\/\//i.test(u)
      );
      const descriptionBlob = longestFrom([
        ".jdesc",
        ".job-description",
        "#jobDesc",
        ".job-desc",
        ".job-detail .jbody",
        ".jbody",
      ]) || "";
      const mailtoEmails = uniqueAnchors
        .filter((u) => u.startsWith("mailto:"))
        .map((u) => u.replace(/^mailto:/i, "").split("?")[0].trim())
        .filter(Boolean);
      const textEmails = [...new Set(descriptionBlob.match(EMAIL_RE) || [])];
      const emails = [...new Set([...mailtoEmails, ...textEmails])].slice(0, 8);

      return {
        title: textFrom(["h1", "h3.s-18", ".jobt h3", ".job-title"]),
        company: textFrom([".cname", ".company-name", "[data-company-name]"]),
        location: textFrom([".jloc", ".location", ".job-loc"]),
        salary: textFrom([".rz-salary", ".sal", ".jsal", ".salary"]),
        description: descriptionBlob,
        skills: Array.from(
          document.querySelectorAll(".skill-tag, .skill, .skills li, .tag-skill")
        )
          .map((el) => el.textContent?.trim())
          .filter(Boolean),
        emails,
        socialLinks: socialLinks.slice(0, 12),
        externalLinks: companyLinks.slice(0, 12),
      };
    });

    const linkedinCompanyUrl =
      (detail.socialLinks || []).find((u) => /linkedin\.com\/company\//i.test(u)) || null;
    const companyWebsiteUrl = (detail.externalLinks || [])[0] || null;
    const companyWebsite = companyWebsiteUrl
      ? await scrapePublicCompanyContext(companyWebsiteUrl)
      : null;

    const companyResearch = {
      websiteUrl: companyWebsiteUrl,
      linkedinCompanyUrl,
      website: companyWebsite,
      researchedAt: new Date().toISOString(),
    };
    console.log(
      `[ROZEE_JOB] detail done url=${url} descLen=${(detail.description || "").length} skills=${(detail.skills || []).length} emails=${(detail.emails || []).length} socials=${(detail.socialLinks || []).length} extLinks=${(detail.externalLinks || []).length} companySite=${companyWebsiteUrl || "-"}`
    );

    if (ownsBrowser && browser) await browser.close();
    return { ...detail, companyResearch, url, source: "rozee" };
  } catch (error) {
    console.error(
      `[ROZEE_JOB] detail failed url=${url} reason=${error instanceof Error ? error.message : "unknown"}`
    );
    if (ownsBrowser && browser) await browser.close();
    throw error;
  }
}
