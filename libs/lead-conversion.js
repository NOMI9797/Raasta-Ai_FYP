/**
 * Scoring + outreach hints for Rozee job-listing leads (company + role context).
 * Keeps logic deterministic; LLM personalization happens separately.
 */

const TECH_HINTS = [
  "react",
  "angular",
  "vue",
  "node",
  "nodejs",
  "python",
  "django",
  "flask",
  "java",
  "spring",
  ".net",
  "dotnet",
  "c#",
  "golang",
  "go ",
  "ruby",
  "rails",
  "php",
  "laravel",
  "sql",
  "postgres",
  "mysql",
  "mongodb",
  "redis",
  "aws",
  "azure",
  "gcp",
  "kubernetes",
  "docker",
  "terraform",
  "devops",
  "machine learning",
  "ml ",
  "ai ",
  "data engineer",
  "analytics",
  "shopify",
  "wordpress",
  "mern",
  "mean",
  "full stack",
  "frontend",
  "backend",
  "mobile",
  "flutter",
  "swift",
  "kotlin",
  "android",
  "ios",
];

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

export function extractSkillHints(text) {
  if (!text || typeof text !== "string") return [];
  const lower = text.toLowerCase();
  const found = [];
  for (const hint of TECH_HINTS) {
    if (lower.includes(hint)) found.push(hint.trim());
  }
  return [...new Set(found)].slice(0, 20);
}

export function outreachHintsFromDescription(description, detail = {}) {
  const text = description || "";
  const textEmails = [...new Set(text.match(EMAIL_RE) || [])];
  const detailEmails = Array.isArray(detail.emails) ? detail.emails : [];
  const emails = [...new Set([...detailEmails, ...textEmails])].slice(0, 8);
  const socialLinks = Array.isArray(detail.socialLinks) ? detail.socialLinks : [];
  const externalLinks = Array.isArray(detail.externalLinks) ? detail.externalLinks : [];
  const canEmail = emails.length > 0;
  return {
    canEmail,
    emailsFound: emails,
    socialLinks,
    externalLinks,
    primaryChannel: canEmail ? "email" : "linkedin",
    note: canEmail
      ? "Email found in posting — ok to reach out by email."
      : socialLinks.some((u) => /linkedin\.com/i.test(u))
        ? "No email in posting — use LinkedIn profile/company link."
        : "No email in posting — prefer LinkedIn or company contact page.",
  };
}

export function scoreRozeeJobLead({
  companyName,
  jobTitle,
  location,
  description,
  skills,
  salary,
}) {
  let score = 28;
  const signals = {};

  if (companyName && companyName.length > 2) {
    score += 14;
    signals.hasCompany = true;
  }
  if (jobTitle && jobTitle.length > 3) {
    score += 10;
    signals.hasTitle = true;
  }
  if (location && location.length > 1) {
    score += 6;
    signals.hasLocation = true;
  }

  const descLen = (description || "").length;
  if (descLen > 200) {
    score += 14;
    signals.richDescription = true;
  }
  if (descLen > 900) {
    score += 8;
    signals.veryRichDescription = true;
  }

  const skillCount = Array.isArray(skills) ? skills.length : 0;
  if (skillCount >= 4) {
    score += 16;
    signals.clearStack = true;
  } else if (skillCount >= 1) {
    score += 7;
    signals.someStack = true;
  }

  if (salary) {
    score += 6;
    signals.hasSalary = true;
  }

  score = Math.min(100, Math.round(score));

  let tier = "C";
  if (score >= 72) tier = "A";
  else if (score >= 52) tier = "B";

  return { score, tier, signals };
}

/**
 * @param {object} lead - DB lead row (rozee job listing: name ≈ company)
 * @param {object} detail - output of scrapeRozeeJobDetail
 */
export function buildRozeeConversionFromDetail(lead, detail) {
  const description = detail.description || "";
  const skillsFromTags = Array.isArray(detail.skills) ? detail.skills.filter(Boolean) : [];
  const skillsFromText =
    skillsFromTags.length > 0
      ? skillsFromTags
      : extractSkillHints(`${description}\n${lead.title || ""}`);

  const companyName = (detail.company || lead.name || lead.company || "").trim() || null;
  const jobTitle = (detail.title || lead.title || "").trim() || null;
  const location =
    (detail.location || lead.sourceData?.location || "").trim().replace(/^,\s*/, "") || null;
  const salary = detail.salary || lead.sourceData?.salary || null;

  const { score, tier, signals } = scoreRozeeJobLead({
    companyName,
    jobTitle,
    location,
    description,
    skills: skillsFromText,
    salary,
  });

  const outreach = outreachHintsFromDescription(description, detail);
  const personalizationMode = tier === "A" ? "company_focused" : "job_focused";

  const maxDescStored = 8000;
  const maxExcerpt = 1400;

  return {
    conversion: {
      version: 1,
      tier,
      score,
      signals,
      personalizationMode,
      enrichment: {
        enrichedAt: new Date().toISOString(),
        jobDescription: description.slice(0, maxDescStored),
        descriptionExcerpt: description.slice(0, maxExcerpt),
        skillsFromJob: skillsFromText,
        pageTitle: detail.title || null,
        pageCompany: detail.company || null,
        pageLocation: detail.location || null,
        companyResearch: detail.companyResearch || null,
        evidence: {
          scrapedEmails: outreach.emailsFound || [],
          socialLinks: outreach.socialLinks || [],
          externalLinks: outreach.externalLinks || [],
          descriptionLength: description.length,
          signalsMatched: Object.keys(signals).filter((k) => signals[k]),
        },
      },
      outreach,
    },
  };
}
