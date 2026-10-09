// How a researched company is contacted. After research every company is sorted into one route:
//   email      — an address was found: the agent writes an email
//   linkedin   — no address, but a decision-maker on LinkedIn: the agent writes a LinkedIn message
//   no_contact — neither: no message is written; a person moves it to Email or LinkedIn by adding a contact
// Pure (no database, no AI), so the agent, the API and the Messages page share it. Relative imports only.

export const CONTACT_ROUTE = { EMAIL: "email", LINKEDIN: "linkedin", NO_CONTACT: "no_contact" };

export const CONTACT_ROUTE_LABELS = {
  email: "Email",
  linkedin: "LinkedIn",
  no_contact: "No contact",
};

const HIRING_TITLE = /\b(hr|human resources?|talent|recruit|people)\b/i;
const LEADER_TITLE = /\b(ceo|founder|owner|managing director|director|president|cto|head)\b/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Who a company message goes to on a channel. Email: a named contact (Hunter) in HR or leadership first,
 * then any named contact, then the company's own address. LinkedIn: the first decision-maker found.
 * @returns {{ address: string, name: string|null, title: string|null } | null}
 */
export function pickRecipient(research, channel) {
  if (!research) return null;
  if (channel === "linkedin") {
    const person = (research.decisionMakers || []).find((p) => p.linkedinUrl);
    return person ? { address: profileLink(person.linkedinUrl) || person.linkedinUrl, name: person.name || null, title: person.title || null } : null;
  }
  const contacts = (research.contacts || []).filter((c) => c.email);
  const named =
    contacts.find((c) => HIRING_TITLE.test(c.title || "")) ||
    contacts.find((c) => LEADER_TITLE.test(c.title || "")) ||
    contacts.find((c) => c.name);
  if (named) return { address: named.email, name: named.name, title: named.title };
  const email = (research.emails || []).find((e) => EMAIL_RE.test(e));
  return email ? { address: email, name: null, title: null } : null;
}

/** Email when an address was found, LinkedIn when only a person was found, otherwise null (no contact). */
export function defaultChannel(research) {
  if (pickRecipient(research, "email")) return "email";
  if (pickRecipient(research, "linkedin")) return "linkedin";
  return null;
}

/**
 * A company's route, from its research and its current message (null until it's researched).
 * A message that already has somewhere to go keeps its channel; an email with no address follows
 * the research (it is rewritten for LinkedIn, or dropped when there's no contact at all).
 */
export function contactRoute(lead, message = null) {
  const research = lead?.sourceData?.research;
  if (message?.channel === "linkedin" && message.recipient) return CONTACT_ROUTE.LINKEDIN;
  if (message?.channel === "email" && message.recipient) return CONTACT_ROUTE.EMAIL;
  if (!research) return null;
  return defaultChannel(research) || CONTACT_ROUTE.NO_CONTACT;
}

/** A clean profile link: "https://www.linkedin.com/in/name/?isSelfProfile=true" → "https://www.linkedin.com/in/name". */
export function profileLink(url) {
  const m = String(url || "").match(/^https?:\/\/(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/in\/([^/?#\s]+)/i);
  return m ? `https://www.linkedin.com/in/${m[1]}` : null;
}
