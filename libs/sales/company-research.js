// Company research for sales: website, contact details and decision-makers of a company that is hiring.
// Web search: Serper.dev when SERPER_API_KEY is set (Google results, reliable), else DuckDuckGo (best effort,
// it blocks after a few searches). Named email contacts: Hunter.io when HUNTER_API_KEY is set.
// Relative imports only.

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const PAGE_TIMEOUT_MS = 8000;
const MAX_PAGE_BYTES = 1_500_000;

// Results on these sites are listings about the company, not the company's own website
const NOT_COMPANY_SITES = [
  "linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com", "youtube.com", "tiktok.com",
  "rozee.pk", "indeed.com", "glassdoor.com", "mustakbil.com", "brightspyre.com", "jobz.pk", "pakpositions.com",
  "bayt.com", "naukri.com", "wikipedia.org", "crunchbase.com", "zoominfo.com", "apollo.io", "rocketreach.co",
  "branches.pk", "worldorgs.com", "top10place.com", "yelp.com", "clutch.co", "goodfirms.co", "google.com",
  "bing.com", "duckduckgo.com", "github.com", "medium.com", "dnb.com", "opencorporates.com", "trustpilot.com",
];

export class SearchBlockedError extends Error {}

export function searchProviderName() {
  return process.env.SERPER_API_KEY ? "serper" : "duckduckgo";
}

export function hunterEnabled() {
  return Boolean(process.env.HUNTER_API_KEY);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = PAGE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, headers: { "User-Agent": USER_AGENT, ...(options.headers || {}) } });
  } finally {
    clearTimeout(timer);
  }
}

// Serper's free plan refuses more than 10 results per search ("Query pattern not allowed for free
// accounts"); more results come from the next page instead
export const SERPER_MAX_RESULTS = Number(process.env.SERPER_MAX_RESULTS) || 10;

async function serperSearch(query, num, page = 1) {
  const res = await fetchWithTimeout("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": process.env.SERPER_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, gl: "pk", num: Math.min(num, SERPER_MAX_RESULTS), ...(page > 1 ? { page } : {}) }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(`Serper search failed (${res.status}${detail?.message ? `: ${detail.message}` : ""})`);
  }
  const data = await res.json();
  return (data.organic || []).map((r) => ({ title: r.title || "", link: r.link || "", snippet: r.snippet || "" }));
}

const decodeHtml = (s) =>
  s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

async function duckDuckGoSearch(query) {
  const res = await fetchWithTimeout("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q: query, kl: "pk-en" }),
  });
  // 202 is DuckDuckGo's "too many searches from this address" page
  if (res.status === 202) throw new SearchBlockedError("DuckDuckGo is limiting searches from this server. Add SERPER_API_KEY for reliable search.");
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const html = await res.text();
  const results = [];
  const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
  let m;
  while ((m = linkRe.exec(html)) && results.length < 10) {
    let link = m[1];
    const target = link.match(/uddg=([^&]+)/);
    if (target) link = decodeURIComponent(target[1]);
    results.push({ title: decodeHtml(m[2]), link, snippet: decodeHtml(m[3] || "") });
  }
  return results;
}

/** Web search through the configured provider. Returns [{ title, link, snippet }]. `page` is Serper only. */
export async function webSearch(query, { num = 8, page = 1 } = {}) {
  if (process.env.SERPER_API_KEY) return serperSearch(query, num, page);
  return page > 1 ? [] : duckDuckGoSearch(query);
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function originOf(url) {
  if (!url) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return `${u.protocol}//${u.hostname}`;
  } catch {
    return null;
  }
}

const isListingSite = (host) => NOT_COMPANY_SITES.some((d) => host === d || host.endsWith(`.${d}`));

/** First word of the company that is long enough to recognise it in a domain or a title. */
function nameToken(companyName) {
  const words = String(companyName || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 3);
  return words[0] || null;
}

/** Pick the company's own website from search results: skip listing sites, prefer a domain that contains its name. */
export function pickWebsite(results, companyName) {
  const token = nameToken(companyName);
  const candidates = results.map((r) => ({ ...r, host: hostOf(r.link) })).filter((r) => r.host && !isListingSite(r.host));
  const named = token && candidates.find((r) => r.host.replace(/[^a-z0-9]/g, "").includes(token));
  const chosen = named || candidates[0];
  return chosen ? originOf(chosen.link) : null;
}

// ─── Reading the website ───

const BAD_EMAIL = /\.(png|jpe?g|gif|svg|webp|css|js)$|sentry|wixpress|example\.|domain\.com|email\.com|yourname|@2x|u003e/i;

/** Cloudflare hides emails as hex in data-cfemail; the first byte is the XOR key. */
function decodeCfEmail(hex) {
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

export function extractContacts(html, pageUrl) {
  const emails = new Set();
  const phones = new Set();
  const socials = {};
  const links = [];

  for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) emails.add(decodeCfEmail(m[1]).toLowerCase());
  for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) emails.add(decodeURIComponent(m[1]).toLowerCase());
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ");
  for (const m of text.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) emails.add(m[0].toLowerCase());

  for (const m of html.matchAll(/href=["']tel:([^"']+)["']/gi)) phones.add(decodeURIComponent(m[1]).replace(/[^\d+]/g, ""));
  for (const m of text.replace(/<[^>]+>/g, " ").matchAll(/(?:\+92|0092)[\s-]?\(?\d{2,3}\)?[\s-]?\d{3}[\s-]?\d{4}|\b(?:UAN[:\s]*)?111[\s-]?\d{3}[\s-]?\d{3}\b/g)) {
    phones.add(m[0].replace(/[^\d+]/g, ""));
  }

  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    const href = m[1];
    if (/linkedin\.com\/company\//i.test(href) && !socials.linkedin) socials.linkedin = href.split("?")[0];
    else if (/facebook\.com\/(?!sharer|share)/i.test(href) && !socials.facebook) socials.facebook = href.split("?")[0];
    else if (/instagram\.com\//i.test(href) && !socials.instagram) socials.instagram = href.split("?")[0];
    else if (/(?:twitter|x)\.com\/(?!intent|share)/i.test(href) && !socials.twitter) socials.twitter = href.split("?")[0];
    else {
      try {
        const abs = new URL(href, pageUrl);
        if (abs.hostname === new URL(pageUrl).hostname && /contact|about|team/i.test(abs.pathname)) links.push(abs.href.split("#")[0]);
      } catch {
        /* not a URL */
      }
    }
  }

  const title = decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "") || null;
  const description =
    decodeHtml(
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ||
        html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)?.[1] ||
        ""
    ) || null;

  return {
    emails: [...emails].filter((e) => !BAD_EMAIL.test(e) && e.length < 80),
    phones: [...phones].filter((p) => p.replace(/\D/g, "").length >= 9),
    socials,
    links: [...new Set(links)],
    title,
    description,
  };
}

/** The same number read twice, once cut short ("+92213483501" and "+922134835018"): keep the full one. */
export function dropPartialNumbers(phones) {
  const digits = (p) => p.replace(/\D/g, "");
  return phones.filter((p) => !phones.some((q) => q !== p && digits(q).length > digits(p).length && digits(q).startsWith(digits(p))));
}

async function fetchHtml(url) {
  const res = await fetchWithTimeout(url, { redirect: "follow" });
  if (!res.ok || !(res.headers.get("content-type") || "").includes("text/html")) return null;
  const html = await res.text();
  return { html: html.slice(0, MAX_PAGE_BYTES), finalUrl: res.url || url };
}

/** Homepage plus up to three contact/about pages. */
export async function readWebsite(origin) {
  const result = { emails: new Set(), phones: new Set(), socials: {}, title: null, description: null, pagesRead: 0 };
  const home = await fetchHtml(origin).catch(() => null);
  if (!home) return null;

  const add = (page) => {
    page.emails.forEach((e) => result.emails.add(e));
    page.phones.forEach((p) => result.phones.add(p));
    result.socials = { ...page.socials, ...result.socials };
    result.pagesRead++;
  };
  const homeData = extractContacts(home.html, home.finalUrl);
  add(homeData);
  result.title = homeData.title;
  result.description = homeData.description;

  const base = originOf(home.finalUrl) || origin;
  const extra = [...homeData.links, `${base}/contact`, `${base}/contact-us`, `${base}/about`].filter((u, i, all) => all.indexOf(u) === i).slice(0, 3);
  for (const url of extra) {
    const page = await fetchHtml(url).catch(() => null);
    if (page) add(extractContacts(page.html, page.finalUrl));
  }

  return {
    url: base,
    title: result.title,
    description: result.description,
    emails: [...result.emails].slice(0, 8),
    phones: dropPartialNumbers([...result.phones]).slice(0, 5),
    socials: result.socials,
    pagesRead: result.pagesRead,
  };
}

// ─── Decision-makers ───

const LEADERSHIP = /\b(ceo|chief|founder|co-founder|owner|managing director|director|president|cto|coo|gm|general manager|head)\b/i;
const HIRING = /\b(hr|human resources?|talent|recruit|people|hiring)\b/i;

/** "Ali Khan - CEO - Cubix | LinkedIn" → { name, title } */
export function parseLinkedInResult(result, companyName) {
  if (!/linkedin\.com\/in\//i.test(result.link)) return null;
  const token = nameToken(companyName);
  const haystack = `${result.title} ${result.snippet}`.toLowerCase();
  if (token && !haystack.includes(token)) return null;

  const clean = result.title.replace(/\s*[|–-]\s*LinkedIn.*$/i, "").trim();
  const parts = clean.split(/\s+[-–|]\s+/).map((s) => s.trim()).filter(Boolean);
  const name = parts[0];
  if (!name || name.length > 60 || /linkedin/i.test(name)) return null;
  const title = parts.slice(1).join(" · ") || result.snippet.slice(0, 100) || null;
  const role = LEADERSHIP.test(title || "") ? "leadership" : HIRING.test(title || "") ? "hiring" : "other";
  return { name, title, linkedinUrl: result.link.split("?")[0], role };
}

export async function findDecisionMakers(companyName, city) {
  const query = `site:linkedin.com/in "${companyName}" (CEO OR founder OR director OR "HR" OR "talent acquisition" OR recruiter)${city ? ` ${city}` : ""}`;
  const results = await webSearch(query, { num: 10 });
  const rank = { leadership: 0, hiring: 1, other: 2 };
  const people = results.map((r) => parseLinkedInResult(r, companyName)).filter(Boolean);
  const unique = people.filter((p, i) => people.findIndex((q) => q.linkedinUrl === p.linkedinUrl) === i);
  return unique.sort((a, b) => rank[a.role] - rank[b.role]).slice(0, 4);
}

async function hunterContacts(domain) {
  const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=10&api_key=${process.env.HUNTER_API_KEY}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Hunter.io failed (${res.status})`);
  const data = await res.json();
  return (data.data?.emails || []).map((e) => ({
    email: e.value,
    name: [e.first_name, e.last_name].filter(Boolean).join(" ") || null,
    title: e.position || null,
    linkedinUrl: e.linkedin || null,
    confidence: e.confidence ?? null,
  }));
}

/**
 * Research one company.
 * @param {{ name: string, location?: string, knownWebsite?: string }} company
 * @returns research object stored on the lead as sourceData.research
 */
export async function researchCompany({ name, location, knownWebsite }) {
  const notes = [];
  const city = location ? String(location).split(",")[0].trim() : "";
  const searchProvider = searchProviderName();

  let website = originOf(knownWebsite);
  let websiteSource = website ? "job board" : null;
  if (!website && name) {
    try {
      website = pickWebsite(await webSearch(`${name} ${city} official website`), name);
      websiteSource = website ? "web search" : null;
      if (!website) notes.push("No website found in search results.");
    } catch (error) {
      notes.push(error.message);
    }
  }

  let site = null;
  if (website) {
    site = await readWebsite(website).catch(() => null);
    if (!site) notes.push("The website could not be read (it may block automated visits).");
  }

  let decisionMakers = [];
  if (name) {
    try {
      decisionMakers = await findDecisionMakers(name, city);
      if (!decisionMakers.length) notes.push("No decision-maker found on LinkedIn.");
    } catch (error) {
      notes.push(`Decision-maker search: ${error.message}`);
    }
  }

  let contacts = [];
  if (hunterEnabled() && website) {
    try {
      contacts = await hunterContacts(hostOf(website));
    } catch (error) {
      notes.push(error.message);
    }
  }

  const found = Boolean(site?.emails.length || site?.phones.length || decisionMakers.length || contacts.length);
  return {
    status: found ? "done" : website ? "partial" : "not_found",
    website: site?.url || website || null,
    websiteSource,
    title: site?.title || null,
    description: site?.description || null,
    emails: site?.emails || [],
    phones: site?.phones || [],
    socials: site?.socials || {},
    decisionMakers,
    contacts,
    searchProvider,
    notes,
    researchedAt: new Date().toISOString(),
  };
}
