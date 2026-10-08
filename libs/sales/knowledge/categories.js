// Knowledge base categories. Shared by the API, the agent's prompts and the Knowledge base page.

export const KB_CATEGORIES = [
  { key: "services", label: "Services", hint: "What you offer, who it is for, what is included" },
  { key: "pricing", label: "Pricing", hint: "Packages, rates, how you quote, payment terms" },
  { key: "process", label: "Process", hint: "How a project runs: steps, timelines, communication" },
  { key: "faq", label: "FAQs", hint: "Questions clients often ask, with your answers" },
  { key: "case_study", label: "Case studies", hint: "Past projects and results you can mention" },
  { key: "about", label: "About us", hint: "Company, team, location, contact details" },
  { key: "other", label: "Other", hint: "Anything else the agent may tell clients" },
];

export const KB_CATEGORY_KEYS = KB_CATEGORIES.map((c) => c.key);

export function categoryLabel(key) {
  return KB_CATEGORIES.find((c) => c.key === key)?.label || "Other";
}

export function normaliseCategory(key) {
  return KB_CATEGORY_KEYS.includes(key) ? key : "other";
}
