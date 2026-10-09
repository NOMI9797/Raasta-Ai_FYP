// LinkedIn replies for the sales agent, read with the connected LinkedIn account: messaging is opened,
// conversations whose preview starts with "You:" are skipped (nothing new), the others are opened and
// the person's messages after our first message are recorded in the lead's thread (channel linkedin),
// then the campaign's agent is woken to answer, exactly like an email reply. Each LinkedIn message has
// a unique id (data-event-urn), so a message is never recorded twice. Relative imports only.
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { conversationMessages, leads } from "../schema";
import { linkedinAdapter } from "../platforms/linkedin";
import { CONVERSATION_STATUS } from "./conversation/status";
import { wakeForReply } from "./inbox/sync";

// Conversations that can still get a reply worth answering
const OPEN = [CONVERSATION_STATUS.AWAITING_REPLY, CONVERSATION_STATUS.IN_CONVERSATION, CONVERSATION_STATUS.MEETING_PROPOSED, CONVERSATION_STATUS.REPLIED];

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

/** The conversation in the messaging list with this person (by name), or -1. */
export function findConversation(items, name) {
  const want = norm(name);
  if (!want) return -1;
  return items.findIndex((it) => norm(it.name) === want);
}

/** A preview "You: …" means our message is the last one: nothing new to read. */
export const lastIsOurs = (item) => /^you:/i.test(String(item?.snippet || "").trim());

/**
 * The person's messages after our first message (earlier history isn't a reply to us).
 * @param {{ sender: string, urn: string, text: string }[]} events in page order
 */
export function newInbound(events, personName) {
  const person = norm(personName);
  const firstOurs = events.findIndex((e) => norm(e.sender) !== person);
  if (firstOurs < 0) return [];
  return events.slice(firstOurs + 1).filter((e) => norm(e.sender) === person && e.urn && String(e.text || "").trim());
}

// Page code is passed as text (the worker runs under tsx). LinkedIn messaging keeps its msg-* markup.
const LIST = `(() => Array.from(document.querySelectorAll("li.msg-conversation-listitem")).map(function (li) {
  var t = function (sel) { var e = li.querySelector(sel); return e ? e.innerText.replace(/\\s+/g, " ").trim() : ""; };
  return { name: t(".msg-conversation-listitem__participant-names") || t(".msg-conversation-card__participant-names"), snippet: t(".msg-conversation-card__message-snippet") };
}))()`;

const EVENTS = `(() => {
  var out = []; var sender = "";
  Array.from(document.querySelectorAll("li.msg-s-message-list__event")).forEach(function (li) {
    var h = li.querySelector(".msg-s-event-listitem--group-a11y-heading");
    if (h) { var m = h.textContent.replace(/\\s+/g, " ").trim().match(/^(.*?) sent the following messages? at/i); if (m) sender = m[1].trim(); }
    Array.from(li.querySelectorAll(".msg-s-event-listitem[data-event-urn]")).forEach(function (ev) {
      var b = ev.querySelector(".msg-s-event-listitem__body");
      out.push({ sender: sender, urn: ev.getAttribute("data-event-urn"), text: b ? b.innerText.trim() : "" });
    });
  });
  return out;
})()`;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Read new LinkedIn replies from these people.
 * @param {object} account the connected LinkedIn account
 * @param {{ leadId: string, name: string }[]} people
 * @returns {Promise<{ leadId, messages: { urn, text }[] }[]>} only people with something new
 */
export async function readLinkedInReplies(account, people, { sleep = pause } = {}) {
  if (!people.length) return [];
  const session = await linkedinAdapter.testSession(account, true);
  if (!session?.isValid) throw new Error(`LinkedIn session invalid: ${session?.reason || "sign in again on Platforms"}`);
  const found = [];
  try {
    const page = session.page;
    await page.goto("https://www.linkedin.com/messaging/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.locator("li.msg-conversation-listitem").first().waitFor({ state: "visible", timeout: 25000 });
    await sleep(2000 + Math.floor(Math.random() * 2000));
    const items = await page.evaluate(LIST);
    for (const person of people) {
      const at = findConversation(items, person.name);
      if (at < 0 || lastIsOurs(items[at])) continue;
      await page.locator("li.msg-conversation-listitem").nth(at).locator("a, .msg-conversation-listitem__link").first().click({ timeout: 10000 });
      await page.locator("li.msg-s-message-list__event").first().waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
      await sleep(2500 + Math.floor(Math.random() * 2000));
      const messages = newInbound(await page.evaluate(EVENTS), person.name).map((e) => ({ urn: e.urn, text: e.text }));
      if (messages.length) found.push({ leadId: person.leadId, messages });
    }
  } finally {
    await linkedinAdapter.cleanupSession(session.context);
  }
  return found;
}

/** Record a person's LinkedIn messages in their thread; returns the ones that were new. */
export async function recordLinkedInReplies(lead, messages, { database = db, now = new Date() } = {}) {
  const added = [];
  for (const m of messages) {
    const [row] = await database.insert(conversationMessages).values({
      userId: lead.userId, leadId: lead.id, campaignId: lead.campaignId,
      direction: "in", channel: "linkedin", kind: "inbound", status: "received",
      fromAddress: lead.url, body: String(m.text).slice(0, 20000),
      emailMessageId: m.urn, // LinkedIn's message id: the same message is never recorded twice
      meta: { fromName: lead.name || null, matchedBy: "linkedin" },
      receivedAt: now, createdAt: now, updatedAt: now,
    }).onConflictDoNothing().returning();
    if (row) added.push(row);
  }
  if (added.length) {
    const changes = { lastReplyAt: now, nextFollowUpAt: null, updatedAt: now };
    if (lead.conversationStatus !== CONVERSATION_STATUS.UNSUBSCRIBED) changes.conversationStatus = CONVERSATION_STATUS.REPLIED;
    await database.update(leads).set(changes).where(eq(leads.id, lead.id));
  }
  return added;
}

/** People of a campaign in an open LinkedIn conversation (our last message went out on LinkedIn). */
export async function openLinkedInConversations(campaignId, { database = db } = {}) {
  const rows = await database.select().from(leads).where(and(eq(leads.campaignId, campaignId), inArray(leads.conversationStatus, OPEN)));
  if (!rows.length) return [];
  const msgs = await database.select({ leadId: conversationMessages.leadId, channel: conversationMessages.channel, direction: conversationMessages.direction, status: conversationMessages.status, createdAt: conversationMessages.createdAt })
    .from(conversationMessages).where(inArray(conversationMessages.leadId, rows.map((l) => l.id)));
  const lastOut = new Map();
  for (const m of msgs.filter((x) => x.direction === "out" && x.status === "sent").sort((a, b) => a.createdAt - b.createdAt)) lastOut.set(m.leadId, m.channel);
  return rows.filter((l) => lastOut.get(l.id) === "linkedin");
}

/**
 * Read and record new LinkedIn replies for a campaign, then wake its agent for each person who wrote.
 * @returns {{ checked: number, replies: number }}
 */
export async function syncLinkedInReplies(account, campaignId, { database = db, read = readLinkedInReplies, wake = wakeForReply, now = new Date() } = {}) {
  const people = await openLinkedInConversations(campaignId, { database });
  if (!people.length) return { checked: 0, replies: 0 };
  const found = await read(account, people.map((l) => ({ leadId: l.id, name: l.sourceData?.profile?.name || l.name })));
  let replies = 0;
  for (const { leadId, messages } of found) {
    const lead = people.find((l) => l.id === leadId);
    const added = await recordLinkedInReplies(lead, messages, { database, now });
    replies += added.length;
    if (added.length) await wake({ lead, row: added[added.length - 1] }, { database });
  }
  return { checked: people.length, replies };
}
