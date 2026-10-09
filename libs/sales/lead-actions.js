// Work on one lead, shared by the API routes (buttons on the Research and Messages steps) and the
// sales agent (worker). Relative imports only.
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { campaigns, kbDocuments, leads, messages, posts, salesSettings, users } from "../schema";
import { getModel } from "../ai/llm";
import { PLATFORM_KIND } from "./stages";
import { companyNameOf, jobsOf } from "./companies";
import { researchCompany } from "./company-research";
import { profileLink } from "./contact-route";
import { CHANNELS, companyPrompt, defaultChannel, personPrompt, pickRecipient, writeMessage } from "./message-writer";

export class LeadActionError extends Error {
  constructor(message, { status = 400, code } = {}) {
    super(message);
    this.name = "LeadActionError";
    this.status = status;
    this.code = code;
  }
}

/** Research a company lead and save it on the lead. Returns the updated lead. */
export async function researchCompanyLead(lead, { database = db } = {}) {
  if (PLATFORM_KIND[lead.source] !== "company") {
    throw new LeadActionError("Only company leads (Rozee.pk, Indeed) are researched this way", { code: "not_company" });
  }
  const name = companyNameOf(lead);
  if (!name) throw new LeadActionError("This job post has no company name to research", { code: "no_name" });

  const sourceData = lead.sourceData || {};
  const research = await researchCompany({
    name,
    location: sourceData.location || jobsOf(lead)[0]?.location,
    knownWebsite: sourceData.company?.website,
  });
  // Contacts a person added (moving a company out of "No contact") survive a new research run
  const added = sourceData.research?.addedByYou || null;
  if (added?.emails?.length) research.emails = [...added.emails, ...research.emails.filter((e) => !added.emails.includes(e))];
  if (added?.decisionMakers?.length) research.decisionMakers = [...added.decisionMakers, ...(research.decisionMakers || []).filter((p) => !added.decisionMakers.some((a) => a.linkedinUrl === p.linkedinUrl))];
  if (added) research.addedByYou = added;
  const [updated] = await database
    .update(leads)
    .set({ sourceData: { ...sourceData, research }, updatedAt: new Date() })
    .where(eq(leads.id, lead.id))
    .returning();
  return updated;
}

const LINKEDIN_PROFILE = /^https?:\/\/([a-z]{2,3}\.)?(www\.)?linkedin\.com\/in\/[^/?#\s]+/i;

/**
 * Move a company out of "No contact": a person adds the email address or LinkedIn profile research
 * couldn't find, and the message for that channel is written.
 * @param {{ channel: "email"|"linkedin", address: string, name?: string, title?: string }} contact
 */
export async function addCompanyContact(lead, userId, { channel, address, name, title }, { database = db } = {}) {
  if (PLATFORM_KIND[lead.source] !== "company") throw new LeadActionError("Only company leads have contacts added this way", { code: "not_company" });
  const value = String(address || "").trim();
  if (channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new LeadActionError("That isn't a valid email address", { code: "bad_email" });
  if (channel === "linkedin" && !LINKEDIN_PROFILE.test(value)) {
    throw new LeadActionError("Paste a LinkedIn profile link, like https://www.linkedin.com/in/name", { code: "bad_linkedin" });
  }
  if (!CHANNELS[channel]) throw new LeadActionError("Choose Email or LinkedIn", { code: "bad_channel" });

  const sourceData = lead.sourceData || {};
  const research = { status: "done", emails: [], phones: [], decisionMakers: [], contacts: [], notes: [], ...(sourceData.research || {}) };
  const added = { emails: [], decisionMakers: [], ...(research.addedByYou || {}) };
  if (channel === "email") {
    const email = value.toLowerCase();
    added.emails = [email, ...added.emails.filter((e) => e !== email)];
    research.emails = [email, ...(research.emails || []).filter((e) => e !== email)];
  } else {
    const url = value.match(LINKEDIN_PROFILE)[0].replace(/^http:/, "https:");
    const person = { name: String(name || "").trim() || null, title: String(title || "").trim() || null, linkedinUrl: url, addedByYou: true };
    added.decisionMakers = [person, ...added.decisionMakers.filter((p) => p.linkedinUrl !== url)];
    research.decisionMakers = [person, ...(research.decisionMakers || []).filter((p) => p.linkedinUrl !== url)];
  }
  research.addedByYou = added;
  const [updated] = await database.update(leads).set({ sourceData: { ...sourceData, research }, updatedAt: new Date() }).where(eq(leads.id, lead.id)).returning();
  const { message } = await writeLeadMessage({ lead: updated, userId, channel, database });
  return { lead: updated, message };
}

/** The lead's top posts by engagement (LinkedIn people), for messages and scoring. */
export async function topPosts(leadId, { database = db, limit = 5 } = {}) {
  return database.select().from(posts).where(eq(posts.leadId, leadId)).orderBy(desc(posts.engagement)).limit(limit);
}

/**
 * Write (or rewrite) a lead's message. A draft or approved message is replaced and goes back to
 * draft; a sent one is never touched. `channel` is only used for companies (email | linkedin).
 * @returns {{ message: object, recipientName: string|null }}
 */
/** Our company name and services, for messages whose campaign doesn't say what we sell. */
export async function ourCompany(userId, { database = db } = {}) {
  const [settings] = await database.select({ companyName: salesSettings.companyName }).from(salesSettings).where(eq(salesSettings.userId, userId)).limit(1);
  const docs = await database.select({ title: kbDocuments.title, content: kbDocuments.content }).from(kbDocuments)
    .where(and(eq(kbDocuments.userId, userId), eq(kbDocuments.category, "services"), eq(kbDocuments.status, "ready"))).limit(1);
  const services = docs[0]?.content ? docs[0].content.replace(/\s+/g, " ").trim().slice(0, 500) : null;
  return settings?.companyName || services ? { name: settings?.companyName || null, services } : null;
}

export async function writeLeadMessage({ lead, userId, channel: requestedChannel, database = db }) {
  const [campaign] = await database.select().from(campaigns).where(eq(campaigns.id, lead.campaignId)).limit(1);
  const [sender] = await database.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  const senderName = sender?.name || null;
  const company = campaign?.icpConfig?.serviceType ? null : await ourCompany(userId, { database });
  const isCompany = PLATFORM_KIND[lead.source] === "company";

  let channel = "linkedin";
  let recipient;
  let prompt;
  if (isCompany) {
    const research = lead.sourceData?.research || null;
    channel = CHANNELS[requestedChannel] ? requestedChannel : defaultChannel(research);
    // No address and no one on LinkedIn: nothing is written until a person adds a contact
    if (!channel) {
      throw new LeadActionError("No email address or LinkedIn profile was found for this company. Add one to move it to Email or LinkedIn.", { status: 409, code: "no_contact" });
    }
    recipient = pickRecipient(research, channel);
    prompt = companyPrompt({ company: companyNameOf(lead), jobs: jobsOf(lead), research, campaign, channel, recipient, senderName, ourCompany: company });
  } else {
    if (lead.status !== "completed") {
      throw new LeadActionError("Read this person's profile first (Research step).", { code: "not_researched" });
    }
    recipient = { address: profileLink(lead.url) || lead.url, name: lead.name, title: lead.title };
    prompt = personPrompt({ lead, posts: await topPosts(lead.id, { database }), campaign, senderName, company });
  }

  const written = await writeMessage({ ...prompt, channel });
  const values = {
    content: written.body,
    subject: written.subject,
    channel,
    recipient: recipient?.address || null,
    model: getModel().slice(0, 50),
    source: lead.source,
    status: "draft",
    approvedAt: null,
    updatedAt: new Date(),
  };

  const [existing] = await database
    .select()
    .from(messages)
    .where(and(eq(messages.leadId, lead.id), eq(messages.userId, lead.userId), inArray(messages.status, ["draft", "approved"])))
    .orderBy(desc(messages.updatedAt))
    .limit(1);

  const [message] = existing
    ? await database.update(messages).set(values).where(eq(messages.id, existing.id)).returning()
    : await database.insert(messages).values({ ...values, userId: lead.userId, leadId: lead.id, campaignId: lead.campaignId }).returning();

  return { message, recipientName: recipient?.name || null };
}
