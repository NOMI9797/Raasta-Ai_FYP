// Answering a reply and sending what was written, shared by the agent (in the worker) and the
// Conversations page (when a person asks the AI for a reply). Relative imports only.
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { conversationMessages, leads, meetings } from "../../schema";
import { NOTIFICATION_TYPES, notify } from "../../notifications";
import { searchKnowledge } from "../knowledge/search";
import { sendSalesEmail, testRecipient } from "../send/email";
import { canBook, confirmMeeting, meetingInvite, offerSlots, openMeetingFor, proposeMeeting } from "../meetings/store";
import { zonedTime } from "../meetings/slots";
import { CONVERSATION_STATUS, INTENT_LABELS } from "./status";
import { nextFollowUpAt, recordOutbound, replySubject, threadReferences } from "./thread";
import { REPLY_ESCALATION, REPLY_PLAN, planReply, proposedTime, replyAddress } from "./decide";
import { readReply } from "./read-reply";
import { composeReply } from "./compose";

// Waiting on the client: they get follow-ups if they go quiet (after our first email, our answer, or our offer of times)
export const FOLLOW_UP_STATUSES = [CONVERSATION_STATUS.AWAITING_REPLY, CONVERSATION_STATUS.IN_CONVERSATION, CONVERSATION_STATUS.MEETING_PROPOSED];

export const who = (lead) => lead?.company || lead?.sourceData?.company?.name || lead?.name || "this lead";

export function planWords(plan) {
  return {
    [REPLY_PLAN.ANSWER]: "an answer",
    [REPLY_PLAN.OFFER]: "an answer offering meeting times",
    [REPLY_PLAN.CONFIRM]: "a meeting confirmation",
    [REPLY_PLAN.NOT_NOW]: "a polite close",
  }[plan] || "a reply";
}

/**
 * Read their reply and write ours. Nothing is stored here.
 * @returns {{ reading, decision, intentLine, draft: object|null, escalations: string[] }} — `draft` holds
 *          the values of the reply to save, or is null when no email should go back (declined, away)
 */
export async function prepareReply({ lead, inbound, thread, settings, senderName }, deps = {}) {
  const database = deps.database || db;
  const now = deps.now || new Date();
  const readFn = deps.readFn || readReply;
  const composeFn = deps.composeFn || composeReply;
  const searchFn = deps.searchFn || searchKnowledge;

  const lastOut = [...thread].reverse().find((m) => m.direction === "out" && m.status === "sent");
  const meeting = await openMeetingFor(lead.id, { database });
  const offeredSlots = meeting?.status === "proposed" ? (meeting.proposedSlots || []) : [];
  const reading = await readFn({ reply: inbound.body, ourLastEmail: lastOut?.body, offeredSlots, timeZone: settings.timezone, now });

  const start = proposedTime(reading, { offeredSlots, timeZone: settings.timezone, zonedTime });
  const proposed = start && !Number.isNaN(start.getTime())
    ? { start, free: await canBook({ userId: lead.userId, leadId: lead.id, start, settings }, { database, now }) }
    : null;
  const decision = planReply({ reading, proposed, now });
  const intentLine = `${who(lead)} replied: ${INTENT_LABELS[reading.intent] || reading.intent}${reading.summary ? ` (${reading.summary})` : ""}`;
  if (!decision.send) return { reading, decision, intentLine, draft: null, escalations: [] };

  // Knowledge for their questions (or their whole reply when they asked nothing in particular)
  const query = reading.questions.length ? reading.questions.join(" ") : inbound.body;
  const { results: passages } = await searchFn({ userId: lead.userId, query, limit: 6 });
  const slots = decision.plan === REPLY_PLAN.OFFER ? await offerSlots({ userId: lead.userId, leadId: lead.id, settings }, { database, now }) : [];
  const meetingInfo = decision.plan === REPLY_PLAN.CONFIRM ? { start: decision.start, minutes: settings.meetingMinutes, link: settings.meetingLink } : null;
  const composed = await composeFn({
    plan: decision.plan, reply: inbound.body, reading, thread, passages,
    companyName: settings.companyName, senderName, timeZone: settings.timezone,
    slots, meeting: meetingInfo, wrongTime: decision.escalations.includes(REPLY_ESCALATION.TIME_UNAVAILABLE),
  });

  const escalations = [...decision.escalations];
  if (!composed.covered) escalations.push(REPLY_ESCALATION.NOT_IN_KNOWLEDGE);
  if (decision.plan === REPLY_PLAN.OFFER && !slots.length && !escalations.includes(REPLY_ESCALATION.TIME_UNAVAILABLE)) escalations.push(REPLY_ESCALATION.TIME_UNAVAILABLE);
  const toAddress = replyAddress(thread, { testRecipient: testRecipient() });
  if (!toAddress) escalations.push("no_recipient");

  return {
    reading, decision, intentLine, escalations,
    draft: {
      userId: lead.userId, leadId: lead.id, campaignId: lead.campaignId,
      direction: "out", channel: "email", kind: "reply", status: "draft",
      fromAddress: process.env.SENDER_EMAIL || null, toAddress,
      subject: replySubject(thread), body: composed.body,
      inReplyTo: inbound.emailMessageId,
      meta: {
        repliesTo: inbound.id,
        plan: decision.plan,
        nextStatus: decision.nextStatus,
        covered: composed.covered,
        escalations,
        passages: composed.sources.map((n) => passages[n - 1]).filter(Boolean)
          .map((p) => ({ id: p.id, title: p.title, category: p.category, similarity: p.similarity, excerpt: p.content.slice(0, 300) })),
        slots: slots.map((s) => ({ start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString() })),
        meetingStart: decision.start ? decision.start.toISOString() : null,
        attendee: { name: reading.contactName || lead.name || null, email: toAddress },
      },
      createdAt: now,
      updatedAt: now,
    },
  };
}

/** Their reply needs no email back: record where the conversation now stands. */
export async function applyNoReply({ lead, decision }, { database = db, now = new Date() } = {}) {
  await database.update(leads).set({
    conversationStatus: decision.nextStatus,
    nextFollowUpAt: decision.plan === REPLY_PLAN.WAIT ? decision.followUpAt : null,
    updatedAt: now,
  }).where(eq(leads.id, lead.id));
  if (decision.plan === REPLY_PLAN.CLOSE) {
    await database.update(meetings).set({ status: "cancelled", outcome: "The client declined", updatedAt: now })
      .where(and(eq(meetings.leadId, lead.id), eq(meetings.status, "proposed")));
  }
}

export async function markInboundHandled(inbound, { intent = null, reading = null, note = null }, { database = db, now = new Date() } = {}) {
  await database.update(conversationMessages)
    .set({ handledAt: now, intent, meta: { ...(inbound.meta || {}), reading, note }, updatedAt: now })
    .where(eq(conversationMessages.id, inbound.id));
}

/**
 * Send a reply or follow-up draft, then book or offer the meeting it carries and move the
 * conversation on. Throws when sending fails (a meeting it confirmed goes back to offered).
 */
export async function sendDraft({ draft, lead, thread, settings, senderName }, deps = {}) {
  const database = deps.database || db;
  const now = deps.now || new Date();
  const emailFn = deps.emailFn || sendSalesEmail;
  const notifyFn = deps.notifyFn || notify;
  if (!draft.toAddress) throw new Error("No email address for this lead: add one before sending");
  const meta = draft.meta || {};

  let meeting = null;
  let calendar = null;
  if (meta.plan === REPLY_PLAN.CONFIRM && meta.meetingStart) {
    meeting = await confirmMeeting({ lead, start: meta.meetingStart, settings, attendee: meta.attendee, conversationMessageId: draft.id }, { database, now });
    calendar = meetingInvite(meeting, {
      organizer: { name: settings.companyName || senderName, email: process.env.SENDER_EMAIL },
      description: `${meeting.title}${meeting.location ? `\nJoin: ${meeting.location}` : ""}`,
    });
  }

  const references = threadReferences(thread);
  let sent;
  try {
    sent = await emailFn({ to: draft.toAddress, subject: draft.subject, body: draft.body, senderName, inReplyTo: draft.inReplyTo, references, calendar });
  } catch (error) {
    // Not booked if the client never got the confirmation
    if (meeting) await database.update(meetings).set({ status: "proposed", updatedAt: now }).where(eq(meetings.id, meeting.id));
    throw error;
  }
  await recordOutbound({
    lead, kind: draft.kind, subject: draft.subject, body: draft.body, toAddress: draft.toAddress, sent,
    draftId: draft.id, inReplyTo: draft.inReplyTo, references, followUpDays: settings.followUpDays,
  }, { database, now });

  if (draft.kind === "reply") {
    if (meta.plan === REPLY_PLAN.OFFER && meta.slots?.length) {
      await proposeMeeting({ lead, slots: meta.slots, settings, attendee: meta.attendee, conversationMessageId: draft.id }, { database, now });
    }
    const status = meta.nextStatus || CONVERSATION_STATUS.IN_CONVERSATION;
    // If they go quiet after our answer, the usual follow-ups start again from now
    await database.update(leads).set({
      conversationStatus: status,
      followUpsSent: 0,
      nextFollowUpAt: FOLLOW_UP_STATUSES.includes(status) ? nextFollowUpAt(now, 0, settings.followUpDays) : null,
      updatedAt: now,
    }).where(eq(leads.id, lead.id));
  }

  if (meeting) {
    await notifyFn({
      userId: lead.userId,
      type: NOTIFICATION_TYPES.MEETING_BOOKED,
      title: `Meeting booked with ${who(lead)}`,
      body: `${meeting.title}, ${new Date(meeting.startAt).toLocaleString("en-GB", { timeZone: settings.timezone, dateStyle: "medium", timeStyle: "short" })}`,
      link: "/dashboard/sales/meetings",
    });
  }
  return { sent, meeting };
}
