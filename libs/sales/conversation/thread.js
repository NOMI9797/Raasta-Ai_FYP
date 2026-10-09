// A lead's email thread: recording what we sent, and reading the conversation back.
// Relative imports only (runs in the worker).
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { conversationMessages, leads } from "../../schema";
import { CONVERSATION_STATUS } from "./status";

const DAY_MS = 24 * 3600 * 1000;
export const DEFAULT_FOLLOW_UP_DAYS = [3, 7]; // after the first email; then the lead is "no response"

/** When the next follow-up is due after `followUpsSent` nudges, or null when they're used up. */
export function nextFollowUpAt(sentAt, followUpsSent, followUpDays = DEFAULT_FOLLOW_UP_DAYS) {
  const days = followUpDays[followUpsSent];
  if (days === undefined) return null;
  const previous = followUpsSent > 0 ? followUpDays[followUpsSent - 1] : 0;
  return new Date(new Date(sentAt).getTime() + (days - previous) * DAY_MS);
}

/**
 * Record an email we sent in the lead's thread and move the conversation on.
 * kind: outreach | reply | follow_up. For a reply or follow-up, pass the draft row's id to update it.
 */
export async function recordOutbound({ lead, kind, subject, body, toAddress, sent, draftId = null, inReplyTo = null, references = null, followUpDays, channel = "email" }, { database = db, now = new Date() } = {}) {
  const values = {
    status: "sent",
    fromAddress: channel === "email" ? process.env.SENDER_EMAIL || null : null,
    toAddress,
    subject,
    body,
    emailMessageId: sent?.messageId || null,
    inReplyTo,
    references: Array.isArray(references) ? references.join(" ") : references,
    sentAt: now,
    updatedAt: now,
  };
  let row;
  if (draftId) {
    [row] = await database.update(conversationMessages).set(values).where(eq(conversationMessages.id, draftId)).returning();
  } else {
    [row] = await database.insert(conversationMessages).values({
      ...values,
      userId: lead.userId,
      leadId: lead.id,
      campaignId: lead.campaignId,
      direction: "out",
      channel,
      kind,
      meta: sent?.redirected ? { testRedirectedTo: sent.to } : null,
      createdAt: now,
    }).returning();
  }

  const leadChanges = { updatedAt: now };
  if (kind === "outreach") {
    leadChanges.conversationStatus = CONVERSATION_STATUS.AWAITING_REPLY;
    leadChanges.followUpsSent = 0;
    leadChanges.nextFollowUpAt = nextFollowUpAt(now, 0, followUpDays);
  } else if (kind === "follow_up") {
    const done = (lead.followUpsSent || 0) + 1;
    leadChanges.followUpsSent = done;
    leadChanges.nextFollowUpAt = nextFollowUpAt(now, done, followUpDays);
    // The last follow-up still gets its wait; the agent closes the lead when that runs out
  }
  await database.update(leads).set(leadChanges).where(eq(leads.id, lead.id));
  return row;
}

/** The channel the conversation is on: the one of our last sent message (email by default). */
export function threadChannel(thread) {
  const last = [...(thread || [])].reverse().find((m) => m.direction === "out" && m.status === "sent");
  return last?.channel === "linkedin" ? "linkedin" : "email";
}

/** The LinkedIn profile we write to in a LinkedIn conversation. */
export function linkedinAddress(thread) {
  const last = [...(thread || [])].reverse().find((m) => m.channel === "linkedin" && m.direction === "out" && m.toAddress);
  return last?.toAddress || null;
}

/** The whole thread, oldest first, without discarded drafts. */
export async function loadThread(leadId, { database = db } = {}) {
  const rows = await database.select().from(conversationMessages).where(eq(conversationMessages.leadId, leadId)).orderBy(asc(conversationMessages.createdAt));
  return rows.filter((r) => r.status !== "discarded");
}

/** Message-IDs of the thread, for the References header of our next email. */
export function threadReferences(thread) {
  return thread.filter((m) => m.emailMessageId).map((m) => m.emailMessageId);
}

/** Subject for our next email in the thread: "Re: <their/our subject>". */
export function replySubject(thread) {
  const last = [...thread].reverse().find((m) => m.subject);
  // The test tag is added again when sending in test mode; Re: once, never "Re: Re:"
  let base = String(last?.subject || "").trim();
  for (let i = 0; i < 10 && /^(re:|\[test\])\s*/i.test(base); i++) base = base.replace(/^(re:|\[test\])\s*/i, "");
  return base ? `Re: ${base}` : "Following up";
}

/** Sent emails that a reply could answer (for the inbox matcher). */
export async function sentEmails({ messageIds = [], since }, { database = db } = {}) {
  const byId = messageIds.length
    ? await database.select().from(conversationMessages).where(and(eq(conversationMessages.direction, "out"), inArray(conversationMessages.emailMessageId, messageIds)))
    : [];
  const recent = await database.select().from(conversationMessages).where(and(
    eq(conversationMessages.direction, "out"),
    eq(conversationMessages.status, "sent"),
    isNotNull(conversationMessages.subject),
  ));
  const fresh = recent.filter((r) => !since || !r.sentAt || new Date(r.sentAt) >= since);
  const all = new Map([...byId, ...fresh].map((r) => [r.id, r]));
  return [...all.values()];
}
