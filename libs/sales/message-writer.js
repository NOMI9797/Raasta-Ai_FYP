// Writes sales messages with the shared LLM helper. People (LinkedIn) get a message built on their recent
// posts; companies (Rozee.pk, Indeed) get an email or a LinkedIn note built on the roles they are hiring for.
// Relative imports only.
import { chatJSON } from "../ai/llm";

export const CHANNELS = { linkedin: "LinkedIn", email: "Email" };
const LINKEDIN_MAX = 600;

// Who to write to and on which channel live in contact-route.js (shared with the Messages page)
export { defaultChannel, pickRecipient } from "./contact-route";

/**
 * What we sell, for the prompt: the campaign's offer, else the company's services from the knowledge
 * base (`company`: { name, services }). A campaign with no offer made the AI write as if we were the
 * ones needing help (found by the LinkedIn end-to-end test).
 */
export function offerContext(campaign, company = null) {
  const icp = campaign?.icpConfig || {};
  const notes = String(campaign?.description || "").trim();
  const lines = [
    company?.name ? `Our company: ${company.name}` : null,
    icp.serviceType ? `What we offer: ${icp.serviceType}` : company?.services ? `What we offer (from our knowledge base): ${company.services}` : null,
    icp.industry ? `Industries we target: ${icp.industry}` : null,
    icp.targetRole ? `Roles we usually talk to: ${icp.targetRole}` : null,
    notes.length >= 12 ? `Campaign notes: ${notes}` : null, // short scribbles ("fwhf") aren't notes
  ].filter(Boolean);
  return lines.length
    ? lines.join("\n")
    : "What we offer is not specified: keep the offer general (a short call to see whether we can help with their work).";
}

// Only the first name, and only for the sign-off: a full account name ("QA Tester") gets read as a job title
function senderLine(senderName) {
  const first = String(senderName || "").trim().split(/\s+/)[0];
  return first ? `Sign the message as: ${first} (use this only for the sign-off; say nothing else about the sender)` : "Sign off without a name.";
}

const RULES = [
  "You are the seller: you offer OUR services to them. Never write as if you were a customer, a job seeker or someone asking them for help.",
  "Write like a real person, not a template. Plain, warm, specific; no buzzwords, no flattery overload.",
  "Never invent facts that are not in the information given. Never use placeholders like [Name] or [Your Name].",
  "Greet the recipient by first name when you know it.",
  "Order: greeting, the message, the closing question, then the sign-off name alone on the last line.",
];

/** @returns {{ system: string, user: string }} */
export function personPrompt({ lead, posts = [], campaign, senderName, company }) {
  const postLines = posts.slice(0, 5).map((p, i) => `${i + 1}. ${String(p.content || "").slice(0, 600)}`).join("\n");
  return {
    system: [
      "You write a first LinkedIn message to a professional, sent after they accept a connection request.",
      `Keep it under ${LINKEDIN_MAX} characters, 3-5 short sentences, ending with one easy question.`,
      ...RULES,
      'Return JSON: {"body": string}',
    ].join("\n"),
    user: [
      senderLine(senderName),
      offerContext(campaign, company),
      "",
      `Recipient: ${lead.name || "unknown"}${lead.title ? `, ${lead.title}` : ""}${lead.company ? ` at ${lead.company}` : ""}`,
      postLines ? `Their recent LinkedIn posts (refer to one naturally):\n${postLines}` : "No recent posts available: open from their role instead.",
    ].join("\n"),
  };
}

/** @returns {{ system: string, user: string }} */
export function companyPrompt({ company, jobs = [], research, campaign, channel, recipient, senderName, ourCompany }) {
  const roles = jobs.map((j) => j.title).filter(Boolean).slice(0, 6);
  const about = [research?.description, research?.title].filter(Boolean)[0];
  const greeting = recipient?.name ? `Address ${recipient.name.split(" ")[0]} by first name.` : `Address the ${company} team.`;
  const format =
    channel === "linkedin"
      ? [`A LinkedIn message to ${recipient?.name || "a decision-maker"} at ${company}, sent after they accept a connection request.`, `Under ${LINKEDIN_MAX} characters, 3-5 short sentences.`, 'Return JSON: {"body": string}']
      : ["A short cold email to the company.", "Subject: under 60 characters, specific, no clickbait. Body: 70-130 words, short paragraphs, one clear ask.", 'Return JSON: {"subject": string, "body": string}'];
  return {
    system: [
      "You write B2B outreach to a company that is currently hiring. Their open roles are the reason to reach out now:",
      "connect what they are hiring for to how we can help (save hiring time, cover the work, or support the new team).",
      ...format,
      ...RULES,
    ].join("\n"),
    user: [
      senderLine(senderName),
      offerContext(campaign, ourCompany),
      "",
      `Company: ${company}`,
      roles.length ? `Open roles: ${roles.join("; ")}` : null,
      about ? `About them (from their website): ${about.slice(0, 500)}` : null,
      recipient?.title ? `Recipient's role: ${recipient.title}` : null,
      greeting,
    ].filter((l) => l !== null).join("\n"),
  };
}

function clean(text) {
  return String(text || "").replace(/\[(your )?name\]/gi, "").trim();
}

/** @returns {Promise<{ subject: string|null, body: string }>} */
export async function writeMessage({ system, user, channel }) {
  const out = await chatJSON({ system, user, temperature: 0.7, maxTokens: 1500 });
  const body = clean(out.body || out.message || "");
  if (!body) throw new Error("The AI did not return a message. Try again.");
  return {
    subject: channel === "email" ? clean(out.subject) || null : null,
    body: channel === "linkedin" && body.length > LINKEDIN_MAX + 200 ? body.slice(0, LINKEDIN_MAX + 200) : body,
  };
}
