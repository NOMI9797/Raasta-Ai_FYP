// Rozee.pk job posts through a web search engine. Rozee.pk answers automated browsers with
// Cloudflare's bot check, so its pages can't be read. What the engines return, all read here (pure, tested):
//  - job posts: title "React Developer Job, Lahore, Dextrologix (Pvt.) Ltd - ROZEE.PK", URL
//    rozee.pk/dextrologix-pvt-ltd-react-developer-lahore-jobs-1404759 (DuckDuckGo returns many of these)
//  - search-listing pages (Google mostly returns these): sometimes a job post's slug inside the URL,
//    and snippets naming jobs and companies: "React JS Developer. MTBC CareCloud ; …"
// Uses SERPER_API_KEY (Google) when set, otherwise DuckDuckGo. Relative imports only.
import { webSearch, searchProviderName } from "./company-research";

// Cities a Rozee title lists before the company name
export const PK_CITIES = [
  "Karachi", "Lahore", "Islamabad", "Rawalpindi", "Faisalabad", "Multan", "Peshawar", "Quetta", "Sialkot", "Gujranwala",
  "Hyderabad", "Abbottabad", "Bahawalpur", "Sargodha", "Sukkur", "Larkana", "Sheikhupura", "Rahim Yar Khan", "Jhang",
  "Dera Ghazi Khan", "Gujrat", "Sahiwal", "Wah Cantt", "Mardan", "Kasur", "Okara", "Mirpur", "Muzaffarabad", "Gwadar",
  "Mansehra", "Chiniot", "Kamoke", "Hafizabad", "Sadiqabad", "Burewala", "Khanewal", "Jhelum", "Attock", "Taxila",
  "Remote", "Anywhere in Pakistan", "Pakistan", "Dubai", "Abu Dhabi", "Sharjah", "Riyadh", "Jeddah", "Doha", "Muscat",
];
const CITY_SET = new Set(PK_CITIES.map((c) => c.toLowerCase()));

export const slugify = (s) =>
  String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const titleCase = (slug) => slug.split("-").filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

/** A Rozee job post URL: www.rozee.pk/<slug>-jobs-<id>. Search pages, company pages and portals are not. */
export function jobPostUrl(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (!/^(www\.)?rozee\.pk$/i.test(url.hostname)) return null;
  const m = url.pathname.match(/^\/([a-z0-9-]+)-jobs-(\d+)\/?$/i);
  if (!m) return null;
  return { url: `https://www.rozee.pk/${m[1]}-jobs-${m[2]}`, slug: m[1].toLowerCase(), jobId: m[2] };
}

/** A job post's slug inside any rozee.pk URL, e.g. a listing page /job/jsearch/q/<slug>-jobs-<id>/… */
export function embeddedPost(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (!/^(www\.)?rozee\.pk$/i.test(url.hostname)) return null;
  const m = decodeURIComponent(url.pathname).match(/\/([a-z0-9-]+)-jobs-(\d+)(?=\/|$)/i);
  if (!m) return null;
  return { url: `https://www.rozee.pk/${m[1].toLowerCase()}-jobs-${m[2]}`, slug: m[1].toLowerCase(), jobId: m[2] };
}

/**
 * Company, role and cities from a slug alone, using the words searched for to find where the role
 * starts: "technerds-inc-react-native-developer-lahore" + "react developer" →
 * { company: "Technerds Inc", title: "React Native Developer", cities: ["Lahore"] }.
 */
export function splitSlug(slug, query) {
  let words = slug.split("-").filter(Boolean);
  const cities = [];
  while (words.length && CITY_SET.has(words[words.length - 1])) cities.unshift(titleCase(words.pop()));
  // Relevant when the specific word searched for ("flutter") is there, not a generic one ("developer")
  const terms = searchTerms(query);
  const hit = words.findIndex((w) => terms.has(w) || [...terms].some((t) => t.length >= 4 && w.startsWith(t))); // "reactjs" is React
  if (hit < 0) return { company: null, title: null, cities, relevant: false };
  // The role starts at its first word: "jma-resources-javascript-developer-react-js" → "Javascript Developer React Js"
  const roleAt = words.findIndex((w) => ROLE_START.has(w));
  const at = roleAt >= 0 ? Math.min(roleAt, hit) : hit;
  const title = titleCase(words.slice(at).join("-"));
  if (at === 0) return { company: null, title, cities, relevant: true };
  const company = words.slice(0, at).join("-");
  return { company: SLUG_COMPANIES[company] || titleCase(company), title, cities, relevant: true };
}

// Words a job title starts with: seniority, technologies and roles (not words company names use, like "software")
const ROLE_START = new Set([
  "senior", "sr", "junior", "jr", "lead", "principal", "associate", "intern", "internship", "trainee", "fresh", "head",
  "developer", "engineer", "programmer", "designer", "architect", "full", "front", "frontend", "back", "backend", "fullstack",
  "javascript", "typescript", "java", "php", "python", "react", "reactjs", "node", "nodejs", "angular", "angularjs", "vue", "vuejs",
  "next", "nextjs", "flutter", "android", "ios", "swift", "kotlin", "dot", "net", "dotnet", "asp", "laravel", "symfony", "drupal",
  "wordpress", "mern", "mean", "django", "ruby", "rails", "golang", "devops", "qa", "sqa", "ui", "ux", "shopify", "unity", "game",
]);
// Slugs Rozee writes differently from the company's name
const SLUG_COMPANIES = { rozeepk: "Rozee.pk" };

const GENERIC = new Set(["developer", "developers", "engineer", "engineers", "job", "jobs", "senior", "junior", "lead", "the", "and", "for", "with"]);

/** The words that make a search specific: "flutter developer" → {flutter}; only generic words → all of them. */
export function searchTerms(query) {
  const words = slugify(query).split("-").filter((w) => w.length > 1);
  const specific = words.filter((w) => !GENERIC.has(w));
  return new Set(specific.length ? specific : words);
}

/** Is this job about what was searched for? (Used for the less certain sources: slugs and snippets.) */
export function isRelevant(title, query) {
  const terms = searchTerms(query);
  if (!terms.size) return true;
  const words = new Set(slugify(title).split("-"));
  return [...terms].some((t) => words.has(t) || slugify(title).includes(t));
}

/** "systems-ltd-senior-reactjs-developer-lahore" + "Senior React.js Developer" → "Systems Ltd" */
export function companyFromSlug(slug, jobTitle) {
  const want = String(jobTitle || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!want) return null;
  const words = slug.split("-").filter(Boolean);
  for (let k = 1; k < words.length; k++) {
    if (words.slice(k).join("").startsWith(want)) return titleCase(words.slice(0, k).join("-"));
  }
  return null;
}

/**
 * One search result → a job post: { jobId, url, title, company, cities, location } or null.
 * Title shapes: "<Title> Job, <City>[, <City>…], <Company> - ROZEE.PK" (company may be missing,
 * and long titles are cut with "..."). When the title is cut, the company comes from the URL slug,
 * which is "<company>-<title>-<cities>".
 */
export function parseRozeeResult({ title = "", link = "" }, { query = "" } = {}) {
  const direct = jobPostUrl(link);
  const post = direct || embeddedPost(link);
  if (!post) return null;
  const clean = String(title).replace(/\s*[-|]\s*ROZEE\.PK\s*$/i, "").trim();
  const truncated = /(\.\.\.|…)$/.test(clean);
  const m = direct ? clean.replace(/(\.\.\.|…)$/, "").match(/^(.*?)\s+Jobs?,\s*(.*)$/i) : null;
  if (!m) {
    // No readable title (a listing page carrying the post, or a title that is just the slug): use the slug
    const fromSlug = splitSlug(post.slug, query);
    if (!fromSlug.relevant || !fromSlug.title) return null; // a different job carried on the listing page
    return { jobId: post.jobId, url: post.url, title: fromSlug.title, company: fromSlug.company, cities: fromSlug.cities, location: fromSlug.cities.join(", ") || null };
  }
  const jobTitle = m[1].trim();
  const parts = m[2].split(",").map((p) => p.trim()).filter(Boolean);

  const cities = [];
  let i = 0;
  while (i < parts.length && CITY_SET.has(parts[i].toLowerCase())) cities.push(parts[i++]);
  let company = truncated ? null : parts.slice(i).join(", ") || null;

  // From the URL: the words before the job title are the company. Compared without separators,
  // because Rozee drops punctuation ("React.js" → "reactjs") where slugify would split it.
  if (!company) company = companyFromSlug(post.slug, jobTitle);
  return {
    jobId: post.jobId,
    url: post.url,
    title: jobTitle,
    company: company || null,
    cities,
    location: cities.join(", ") || null,
  };
}

const ROLE_WORDS = /\b(developer|engineer|designer|manager|analyst|intern|internship|lead|architect|consultant|specialist|officer|executive|tester|qa|devops|administrator|programmer|scientist|writer|marketer|associate|trainee|technician|accountant|coordinator|representative|assistant|head|director)\b/i;
const NOT_A_COMPANY = /\b(developer|engineer|designer|manager|analyst|intern|internship|experience|years?|jobs?|edit|alert|hiring|remote|on-?site|full-?time|part-?time|salary|apply|senior|junior|pakistan)\b|\d{4}|\.\.\./i;
const CITY_ALT = PK_CITIES.filter((c) => c !== "Pakistan").map((c) => c.replace(/ /g, "\\s")).join("|");

/** Does this look like a company name (and not a job title, a city or snippet noise)? */
export function looksLikeCompany(name) {
  const n = String(name || "").trim();
  const balanced = (n.match(/\(/g) || []).length === (n.match(/\)/g) || []).length;
  return n.length >= 2 && n.length <= 60 && /^[A-Za-z0-9]/.test(n) && balanced && !n.includes("/")
    && !NOT_A_COMPANY.test(n) && !ROLE_WORDS.test(n) && !CITY_SET.has(n.toLowerCase());
}

/** Does this look like a job title? */
export function looksLikeRole(title) {
  const t = String(title || "").trim();
  return t.length >= 3 && t.length <= 90 && /^[A-Za-z]/.test(t) && ROLE_WORDS.test(t) && !/jobs in pakistan|save as alert|\bedit\b/i.test(t);
}

/**
 * Jobs and companies named in a listing page's snippet. Pieces are separated by " ; ", " · " or "…",
 * and read "<Role>. <Company> [<City>, Pakistan]": "React JS Developer. MTBC CareCloud ; …" →
 * [{ title: "React JS Developer", company: "MTBC CareCloud", city: null }]. Noise is dropped.
 */
export function parseListingSnippet(snippet) {
  const out = [];
  const cityRe = new RegExp(`^(.+?)\\s+(${CITY_ALT})\\b`, "i");
  for (const raw of String(snippet || "").split(/\s+[;·]\s+|\s*(?:…|\.\.\.)\s*/)) {
    const m = raw.trim().match(/^(.+?)\.\s+(.+)$/);
    if (!m) continue;
    const title = m[1].replace(/^we['’]re hiring:\s*/i, "").trim();
    const rest = m[2].trim();
    const withCity = rest.match(cityRe);
    const company = (withCity ? withCity[1] : rest.split(/\.\s|\s\d/)[0]).replace(/[.,;]+$/, "").trim();
    if (looksLikeRole(title) && looksLikeCompany(company)) out.push({ title, company, city: withCity ? withCity[2] : null });
  }
  return out;
}

/** Search-engine queries for a Rozee search, most specific first. */
export function buildRozeeQueries({ query, location }) {
  const q = String(query || "").trim();
  const loc = String(location || "").trim();
  const base = "site:rozee.pk";
  return [
    `${base} ${q ? `"${q}"` : ""} ${loc} job`.replace(/\s+/g, " ").trim(),
    `${base} ${q} ${loc} jobs`.replace(/\s+/g, " ").trim(),
  ].filter((v, idx, all) => all.indexOf(v) === idx);
}

/** Does a post match the city asked for? Posts without a city are kept. */
export function inLocation(post, location) {
  const loc = String(location || "").trim().toLowerCase();
  if (!loc || !post.cities.length) return true;
  return post.cities.some((c) => c.toLowerCase().includes(loc) || loc.includes(c.toLowerCase()));
}

// Pages fetched per Rozee search: each costs one Serper credit (2,500 free)
export const MAX_SEARCH_CALLS = 4;

/**
 * Rozee.pk job posts for a keyword and city, in the shape the import step expects
 * (the same as Indeed results): [{ url, name, company, title, location, source: "rozee", sourceData }].
 * Job posts come first; companies named in listing snippets fill up to the limit (one per company).
 */
export async function searchRozeeJobPosts({ query, location, limit = 25 } = {}, { search = webSearch, maxCalls = MAX_SEARCH_CALLS } = {}) {
  if (!String(query || "").trim() && !String(location || "").trim()) throw new Error("Enter a job title or a location");
  const items = new Map(); // key → item
  const companies = new Set();
  const add = (key, item) => {
    const c = item.company ? slugify(item.company) : null;
    if (items.has(key) || (c && companies.has(c))) return;
    if (c) companies.add(c);
    items.set(key, item);
  };

  let calls = 0;
  const exhausted = new Set(); // queries whose last page came back empty or short: no next page
  const plan = buildRozeeQueries({ query, location }).flatMap((q) => [{ q, page: 1 }, { q, page: 2 }]);
  for (const { q, page } of plan) {
    if (items.size >= limit || calls >= maxCalls) break;
    if (exhausted.has(q)) continue;
    calls++;
    const results = await search(q, { num: 10, page });
    if (results.length < 10) exhausted.add(q);
    for (const r of results) {
      const post = parseRozeeResult(r, { query });
      if (post && inLocation(post, location)) add(`post:${post.jobId}`, { ...post, kind: "post", snippet: r.snippet || "" });
      for (const p of parseListingSnippet(r.snippet)) {
        if (!inLocation({ cities: p.city ? [p.city] : [] }, location) || !isRelevant(p.title, query)) continue;
        // No post URL for these: link to the listing page they were named on (unique per company)
        add(`listing:${slugify(p.company)}`, {
          kind: "listing", jobId: null, url: `${r.link.split("#")[0]}#${slugify(p.company)}`,
          title: p.title, company: p.company, cities: p.city ? [p.city] : [], location: p.city || location || null, snippet: r.snippet || "",
        });
      }
    }
  }

  const ordered = [...items.values()].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "post" ? -1 : 1));
  return ordered.slice(0, limit).map((p) => ({
    url: p.url,
    name: p.company,
    company: p.company,
    title: p.title,
    location: p.location,
    salary: null,
    source: "rozee",
    sourceData: {
      location: p.location,
      cities: p.cities,
      rozeeJobId: p.jobId,
      rozeeFoundOn: p.kind, // post: the job post itself; listing: named on a Rozee search page
      description: p.snippet || "",
      foundVia: searchProviderName(),
      company: { name: p.company },
    },
  }));
}
