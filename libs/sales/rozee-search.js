// Rozee.pk job posts through a web search engine. Rozee.pk answers automated browsers with
// Cloudflare's bot check, so its pages can't be read; search engines index every job post with a
// consistent title, "React Developer Job, Lahore, Dextrologix (Pvt.) Ltd - ROZEE.PK", and URL,
// rozee.pk/dextrologix-pvt-ltd-react-developer-lahore-jobs-1404759. Reading those is pure (tested).
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
export function parseRozeeResult({ title = "", link = "" }) {
  const post = jobPostUrl(link);
  if (!post) return null;
  const clean = String(title).replace(/\s*[-|]\s*ROZEE\.PK\s*$/i, "").trim();
  const truncated = /(\.\.\.|…)$/.test(clean);
  const m = clean.replace(/(\.\.\.|…)$/, "").match(/^(.*?)\s+Jobs?,\s*(.*)$/i);
  if (!m) return null;
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

/**
 * Rozee.pk job posts for a keyword and city, in the shape the import step expects
 * (the same as Indeed results): [{ url, name, company, title, location, source: "rozee", sourceData }].
 */
export async function searchRozeeJobPosts({ query, location, limit = 25 } = {}, { search = webSearch } = {}) {
  if (!String(query || "").trim() && !String(location || "").trim()) throw new Error("Enter a job title or a location");
  const seen = new Map();
  for (const q of buildRozeeQueries({ query, location })) {
    if (seen.size >= limit) break;
    const results = await search(q, { num: Math.min(100, Math.max(10, limit * 2)) });
    for (const r of results) {
      const post = parseRozeeResult(r);
      if (post && !seen.has(post.jobId) && inLocation(post, location)) seen.set(post.jobId, { ...post, snippet: r.snippet || "" });
    }
  }
  return [...seen.values()].slice(0, limit).map((p) => ({
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
      description: p.snippet || "",
      foundVia: searchProviderName(),
      company: { name: p.company },
    },
  }));
}
