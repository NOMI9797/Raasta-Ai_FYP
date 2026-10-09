// Company leads (Rozee.pk, Indeed): one lead per company, holding every job post it has open.
// A job post is the buying signal; the company is who we sell to. Relative imports only.

const LEGAL_SUFFIXES = /\b(pvt|private|ltd|limited|llc|inc|incorporated|corp|corporation|co|company|plc|gmbh|smc|pakistan|pk)\b/g;
// Words a company drops or adds to its name: "Nessovo", "Nessovo Solutions" and "Nessovo Technologies"
// are one company (found by the end-to-end agent run). Only trailing ones, and never the whole name.
const DESCRIPTORS = new Set(["solution", "solutions", "technology", "technologies", "tech", "systems", "services", "software", "labs", "global", "international", "group", "consulting", "consultants", "enterprises", "studio", "studios"]);

/** "Cubix Inc.", "CUBIX (Pvt) Ltd" and "Cubix Technologies" → "cubix". Null when there is no usable name. */
export function companyKey(name) {
  if (!name || typeof name !== "string") return null;
  const words = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(LEGAL_SUFFIXES, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && DESCRIPTORS.has(words[words.length - 1]) && words.slice(0, -1).join(" ").length >= 4) words.pop();
  return words.join(" ") || null;
}

/** A lead's company key, worked out from its name now (keys stored by older versions may differ). */
export function leadCompanyKey(lead) {
  return companyKey(companyNameOf(lead)) || lead?.sourceData?.companyKey || null;
}

/** The company name of a lead: job-board leads keep it in `company`, older ones only in `name`. */
export function companyNameOf(lead) {
  return lead?.company || lead?.name || null;
}

/** One job post as stored in sourceData.jobs. */
export function jobFromProfile(profile, source) {
  return {
    url: profile.url,
    title: profile.title || null,
    location: profile.location || profile.sourceData?.location || null,
    salary: profile.salary || profile.sourceData?.salary || null,
    datePosted: profile.sourceData?.datePosted || null,
    source,
  };
}

/** The job posts of a lead; leads created before grouping only have their own row. */
export function jobsOf(lead) {
  const jobs = lead?.sourceData?.jobs;
  if (Array.isArray(jobs) && jobs.length) return jobs;
  return lead?.url ? [jobFromProfile({ url: lead.url, title: lead.title, sourceData: lead.sourceData }, lead.source)] : [];
}

/** Add jobs to a list, skipping URLs already there. Returns a new array. */
export function mergeJobs(existing, incoming) {
  const seen = new Set(existing.map((j) => j.url));
  const merged = [...existing];
  for (const job of incoming) {
    if (job?.url && !seen.has(job.url)) {
      seen.add(job.url);
      merged.push(job);
    }
  }
  return merged;
}

/**
 * Group scraped job posts by company. Posts without a company name stay on their own.
 * @returns {{ key: string|null, name: string|null, profiles: object[] }[]}
 */
export function groupProfilesByCompany(profiles) {
  const groups = new Map();
  const loose = [];
  for (const p of profiles) {
    const name = p.company || p.name || null;
    const key = companyKey(name);
    if (!key) {
      loose.push({ key: null, name, profiles: [p] });
      continue;
    }
    if (!groups.has(key)) groups.set(key, { key, name, profiles: [] });
    groups.get(key).profiles.push(p);
  }
  return [...groups.values(), ...loose];
}

/**
 * Find company leads in one campaign that are the same company.
 * @returns {{ keep: object, merge: object[] }[]} the oldest lead is kept
 */
export function findDuplicateCompanies(leads) {
  const groups = new Map();
  for (const lead of leads) {
    const key = leadCompanyKey(lead);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(lead);
  }
  return [...groups.values()]
    .filter((list) => list.length > 1)
    .map((list) => {
      const sorted = [...list].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      return { keep: sorted[0], merge: sorted.slice(1) };
    });
}
