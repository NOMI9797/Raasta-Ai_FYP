// Work on one lead, shared by the API routes (buttons on the Research and Messages steps) and the
// sales agent (worker). Relative imports only.
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { campaigns, leads, messages, posts, users } from "../schema";
import { getModel } from "../ai/llm";
import { PLATFORM_KIND } from "./stages";
import { companyNameOf, jobsOf } from "./companies";
import { researchCompany } from "./company-research";
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
  const [updated] = await database
    .update(leads)
    .set({ sourceData: { ...sourceData, research }, updatedAt: new Date() })
    .where(eq(leads.id, lead.id))
    .returning();
  return updated;
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
export async function writeLeadMessage({ lead, userId, channel: requestedChannel, database = db }) {
  const [campaign] = await database.select().from(campaigns).where(eq(campaigns.id, lead.campaignId)).limit(1);
  const [sender] = await database.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  const senderName = sender?.name || null;
  const isCompany = PLATFORM_KIND[lead.source] === "company";

  let channel = "linkedin";
  let recipient;
  let prompt;
  if (isCompany) {
    const research = lead.sourceData?.research || null;
    channel = CHANNELS[requestedChannel] ? requestedChannel : defaultChannel(research);
    recipient = pickRecipient(research, channel);
    prompt = companyPrompt({ company: companyNameOf(lead), jobs: jobsOf(lead), research, campaign, channel, recipient, senderName });
  } else {
    if (lead.status !== "completed") {
      throw new LeadActionError("Read this person's profile first (Research step).", { code: "not_researched" });
    }
    recipient = { address: lead.url, name: lead.name, title: lead.title };
    prompt = personPrompt({ lead, posts: await topPosts(lead.id, { database }), campaign, senderName });
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
