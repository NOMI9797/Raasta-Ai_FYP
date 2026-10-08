import "../../libs/load-env"; // first: the database client reads DATABASE_URL when it loads
// Integration: replies, answers, meetings and follow-ups against the real database.
// The mailbox, the AI and email are fakes (the real prompt building, parsing, decisions, slot
// finding and calendar invites all run). Repeats the manual test where a reply to the Zoho email
// ("price? NDA? Monday 3pm?") was answered from the knowledge base and the meeting was booked.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "../../libs/db";
import { agentActions, agentRuns, conversationMessages, leads, meetings } from "../../libs/schema";
import { advanceSalesRun } from "../../libs/sales/agent/sales-agent";
import { decideAction } from "../../libs/agent/actions";
import { recordOutbound } from "../../libs/sales/conversation/thread";
import { recordReply, syncSalesInbox, wakeForReply } from "../../libs/sales/inbox/sync";
import {
  closeDatabase, createCampaign, createCompanyLead, createRun, createUser, databaseReady, fakeEmail, fakeNotify, getLead, getRun,
  nextWeekday, removeUser, resetLlm, tickUntilIdle, useFakeLlm,
} from "./helpers/fixtures";

let ready = false;
let user;
const DAY = nextWeekday(3); // a working day far enough ahead to be bookable

before(async () => {
  ready = await databaseReady();
  if (!ready) return;
  user = await createUser({ name: "Nouman Ahmed" });
  useFakeLlm([
    // Reading a reply: what the client wants, by what they wrote
    {
      when: (system) => system.includes("You read a client's reply"),
      reply: (system, userText) => {
        const reply = userText.split("THEIR REPLY:\n")[1] || "";
        const base = { confidence: 0.95, sentiment: "positive", questions: [], sensitive: false, contactName: "Ali", summary: "test reading" };
        if (/NDA/.test(reply)) return { ...base, intent: "meeting", questions: ["How much does a senior developer cost per month?", "Can you sign an NDA?"], proposedStart: `${DAY}T15:00` };
        if (/second option/.test(reply)) return { ...base, intent: "pick_slot", chosenSlot: 2 };
        if (/interested/.test(reply)) return { ...base, intent: "interested" };
        if (/discount/.test(reply)) return { ...base, intent: "question", questions: ["Can you give us a discount?"], sensitive: true };
        if (/smart contract/.test(reply)) return { ...base, intent: "question", questions: ["Do you audit smart contracts?"] };
        if (/stop emailing/.test(reply)) return { ...base, intent: "unsubscribe", sentiment: "negative" };
        if (/out of the office/.test(reply)) return { ...base, intent: "out_of_office", returnDate: DAY };
        return { ...base, intent: "question", questions: ["What do you do?"] };
      },
    },
    // Writing the answer: placeholders where the code puts times / the meeting
    {
      when: (system) => system.includes("You write email replies"),
      reply: (system, userText) => {
        const covered = !/smart contract/.test(userText);
        const slot = system.includes("{{MEETING}}") ? "\n\n{{MEETING}}" : system.includes("{{TIMES}}") ? "\n\n{{TIMES}}" : "";
        return { body: `Hi Ali,\n\nA senior developer is from $4,000 per month, and yes, we sign NDAs.${slot}\n\nNouman`, covered, sources: covered ? [1] : [] };
      },
    },
    {
      when: (system) => system.includes("follow-up number"),
      reply: (system) => ({ body: system.includes("last one") ? "Hi,\n\nI won't keep writing; the door is open.\n\nNouman" : "Hi,\n\nWe can start within two weeks. Worth a chat?\n\nNouman" }),
    },
  ]);
});
after(async () => {
  resetLlm();
  if (user) await removeUser(user.id);
  await closeDatabase();
});

const passages = async () => ({ results: [{ id: "p1", title: "Pricing", category: "pricing", content: "Senior developer from $4,000 per month. We sign NDAs.", similarity: 0.7 }], topSimilarity: 0.7 });

function deps(email, notify = fakeNotify()) {
  return { tick: async () => {}, notifyFn: notify.fn, emailFn: email.send, conversation: { searchFn: passages } };
}

/** A company we already emailed (as the agent would have): lead + first email in its thread. */
async function emailedLead(campaign, company) {
  const lead = await createCompanyLead(user.id, campaign.id, { company, messageSent: true });
  const outreach = await recordOutbound({
    lead, kind: "outreach", subject: `Help with your ${company} hiring`, body: "Hi team,\n\nWe can help.\n\nNouman",
    toAddress: `hr@${company.toLowerCase().replace(/\s+/g, "")}.test`, sent: { messageId: `<outreach-${lead.id}@test>` },
  });
  return { lead: await getLead(lead.id), outreach };
}

/** The client's reply arrives in our mailbox. */
async function clientReplies(outreach, text, { from } = {}) {
  const recorded = await recordReply({
    mail: {
      messageId: `<reply-${Math.random().toString(36).slice(2)}@client>`, inReplyTo: outreach.emailMessageId, references: outreach.emailMessageId,
      from: from || outreach.toAddress, fromName: "Ali", to: ["sales@test"], subject: `Re: ${outreach.subject}`,
      text: `${text}\n\nOn Mon, 5 Oct 2026, Nouman <sales@test> wrote:\n> Hi team,\n> We can help.`, date: new Date(),
    },
    sentRow: outreach,
    by: "thread",
  });
  return recorded;
}

const actionsFor = (runId, leadId, action) =>
  db.select().from(agentActions).where(and(eq(agentActions.agentRunId, runId), eq(agentActions.leadId, leadId), eq(agentActions.action, action)));
const threadOf = (leadId) => db.select().from(conversationMessages).where(eq(conversationMessages.leadId, leadId)).orderBy(conversationMessages.createdAt);
const meetingOf = async (leadId) => (await db.select().from(meetings).where(eq(meetings.leadId, leadId)))[0];

// ─── Reading the mailbox ───

test("Inbox: replies are matched to our emails; other mail is ignored and never stored", async (t) => {
  if (!ready) return t.skip("database not reachable");
  const campaign = await createCampaign(user.id, { name: "Inbox test" });
  const { lead: one, outreach: first } = await emailedLead(campaign, "Thread Co");
  const { lead: two, outreach: second } = await emailedLead(campaign, "Subject Co");
  const mailbox = [
    { uid: 1, mail: { messageId: "<m1@c>", inReplyTo: first.emailMessageId, from: "someone@threadco.test", subject: "Re: whatever", text: "Sounds good!\n\n> quoted", date: new Date() } },
    { uid: 2, mail: { messageId: "<m2@c>", from: second.toAddress, subject: `RE: ${second.subject}`, text: "Tell me more", date: new Date() } },
    { uid: 3, mail: { messageId: "<m3@c>", from: "newsletter@shop.test", subject: "50% off", text: "Sale", date: new Date() } },
    { uid: 4, mail: { messageId: "<m4@c>", from: "mailer-daemon@googlemail.com", subject: `Delivery failed: ${second.subject}`, text: "bounce", date: new Date() } },
  ];
  const store = new Map();
  const redis = {
    set: async (k, v, ...args) => (args.includes("NX") && store.has(k) ? null : (store.set(k, v), "OK")),
    get: async (k) => store.get(k) ?? null,
    del: async (k) => store.delete(k),
  };
  const notify = fakeNotify();
  const fetchMail = async (state) => ({ messages: mailbox, state: { uidValidity: "1", lastUid: 4, seen: state.lastUid || 0 } });

  const result = await syncSalesInbox({ redis, fetchMail, tick: async () => {}, notifyFn: notify.fn });
  assert.deepEqual([result.checked, result.replies, result.ignored], [4, 2, 2]);

  const [threadReply] = (await threadOf(one.id)).filter((m) => m.direction === "in");
  assert.equal(threadReply.body, "Sounds good!", "quoted history removed");
  assert.equal(threadReply.meta.matchedBy, "thread");
  assert.equal((await threadOf(two.id)).find((m) => m.direction === "in").meta.matchedBy, "subject");
  assert.equal((await getLead(one.id)).conversationStatus, "replied");
  assert.equal((await getLead(one.id)).nextFollowUpAt, null, "a reply stops the follow-up timer");
  assert.equal(notify.all.length, 2);
  assert.match(notify.all[0].body, /no sales agent is running/);

  // Reading the same mail again stores nothing twice
  const again = await syncSalesInbox({ redis, fetchMail, tick: async () => {}, notifyFn: notify.fn });
  assert.equal(again.replies, 0);
  assert.equal((await threadOf(one.id)).filter((m) => m.direction === "in").length, 1);
});

test("Inbox: a reply wakes the campaign's agent, re-opening a finished run", async (t) => {
  if (!ready) return t.skip("database not reachable");
  const campaign = await createCampaign(user.id, { name: "Wake test" });
  const { outreach } = await emailedLead(campaign, "Wake Co");
  const run = await createRun(user.id, campaign.id, { mode: "assisted" });
  await db.update(agentRuns).set({ status: "completed", completedAt: new Date() }).where(eq(agentRuns.id, run.id));
  const ticks = [];
  const recorded = await clientReplies(outreach, "Hello, what do you do?");
  const woke = await wakeForReply(recorded, { tick: async (id) => ticks.push(id), notifyFn: async () => {} });
  assert.equal(woke, run.id);
  assert.deepEqual(ticks, [run.id]);
  assert.equal((await getRun(run.id)).status, "waiting");
});

// ─── Answering ───

test("Semi-auto: a question with a time is answered from the knowledge base, and booking waits for approval", async (t) => {
  if (!ready) return t.skip("database not reachable");
  const campaign = await createCampaign(user.id, { name: "Booking test" });
  const { lead, outreach } = await emailedLead(campaign, "Zoho Test");
  const run = await createRun(user.id, campaign.id, { mode: "assisted" });
  const email = fakeEmail();
  const notify = fakeNotify();
  const inbound = await clientReplies(outreach, "How much would a senior developer cost per month, and can you sign an NDA first? Could we talk on that day at 3pm?");

  await tickUntilIdle(advanceSalesRun, run.id, deps(email, notify));

  const [send] = await actionsFor(run.id, lead.id, "send_reply");
  assert.equal(send.status, "pending", "Semi-auto asks first");
  assert.deepEqual(send.escalations, []);
  assert.equal(email.sent.length, 0);
  const draft = (await threadOf(lead.id)).find((m) => m.status === "draft");
  assert.equal(draft.meta.plan, "confirm");
  assert.match(draft.body, /\$4,000 per month/);
  assert.match(draft.body, /3:00 PM Pakistan time \(UTC\+5\), 30 minutes\nJoin here: https:\/\/meet\.example\.com\/test-room/, "time and link filled in by code");
  assert.equal(draft.toAddress, outreach.toAddress);
  assert.equal(draft.inReplyTo, inbound.row.emailMessageId);
  assert.ok((await threadOf(lead.id)).find((m) => m.direction === "in").handledAt, "their reply is marked handled");

  // Approved: sent in the thread with a calendar invite, and the meeting is booked
  await decideAction({ actionId: send.id, userId: user.id, decision: "approve" });
  await advanceSalesRun(run.id, deps(email, notify));
  assert.equal(email.sent.length, 1);
  const sent = email.sent[0];
  assert.equal(sent.subject, `Re: ${outreach.subject}`);
  assert.equal(sent.inReplyTo, inbound.row.emailMessageId);
  assert.deepEqual(sent.references, [outreach.emailMessageId, inbound.row.emailMessageId]);
  assert.equal(sent.calendar.method, "REQUEST");
  assert.match(sent.calendar.content.replace(/\r\n /g, ""), new RegExp(`DTSTART:${DAY.replace(/-/g, "")}T100000Z`), "15:00 Karachi = 10:00 UTC");
  assert.match(sent.calendar.content.replace(/\r\n /g, ""), /ATTENDEE;CN=Ali;.*mailto:hr@zohotest.test/);

  const meeting = await meetingOf(lead.id);
  assert.equal(meeting.status, "confirmed");
  assert.equal(meeting.startAt.toISOString(), `${DAY}T10:00:00.000Z`);
  assert.equal(meeting.location, "https://meet.example.com/test-room");
  assert.equal((await getLead(lead.id)).conversationStatus, "meeting_booked");
  assert.ok(notify.all.some((n) => n.type === "meeting_booked"));
  assert.equal((await getRun(run.id)).status, "completed", "nothing left open: the run finishes");
});

test("Auto: interest gets three free times; picking one books it without asking", async (t) => {
  if (!ready) return t.skip("database not reachable");
  const campaign = await createCampaign(user.id, { name: "Auto booking test" });
  const { lead, outreach } = await emailedLead(campaign, "Nova Apps");
  const run = await createRun(user.id, campaign.id, { mode: "autopilot" });
  const email = fakeEmail();

  await clientReplies(outreach, "We're interested, tell me more.");
  await tickUntilIdle(advanceSalesRun, run.id, deps(email));

  assert.equal(email.sent.length, 1, "sent without asking");
  const offerLines = email.sent[0].body.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(offerLines.length, 3, "three times offered");
  assert.match(email.sent[0].body, /\(All times Pakistan time \(UTC\+5\)\.\)/);
  let meeting = await meetingOf(lead.id);
  assert.equal(meeting.status, "proposed");
  assert.equal(meeting.proposedSlots.length, 3);
  const afterOffer = await getLead(lead.id);
  assert.equal(afterOffer.conversationStatus, "meeting_proposed");
  assert.ok(afterOffer.nextFollowUpAt, "they get a follow-up if they go quiet");

  // "The second option works"
  const ourOffer = (await threadOf(lead.id)).filter((m) => m.direction === "out").pop();
  await clientReplies({ ...outreach, emailMessageId: ourOffer.emailMessageId }, "The second option works for me.");
  await tickUntilIdle(advanceSalesRun, run.id, deps(email));

  assert.equal(email.sent.length, 2);
  assert.ok(email.sent[1].calendar, "confirmation carries the invite");
  meeting = await meetingOf(lead.id);
  assert.equal(meeting.status, "confirmed");
  assert.equal(meeting.startAt.toISOString(), new Date(meeting.proposedSlots[1].start).toISOString(), "the slot they picked");
  assert.equal((await getLead(lead.id)).conversationStatus, "meeting_booked");
});

test("Auto still asks a person about discounts and about anything the knowledge base doesn't cover", async (t) => {
  if (!ready) return t.skip("database not reachable");
  const campaign = await createCampaign(user.id, { name: "Escalation test" });
  const { lead: haggler, outreach: o1 } = await emailedLead(campaign, "Haggle Co");
  const { lead: crypto, outreach: o2 } = await emailedLead(campaign, "Chain Co");
  const run = await createRun(user.id, campaign.id, { mode: "autopilot" });
  const email = fakeEmail();

  await clientReplies(o1, "Can you give us a discount if we sign for a year?");
  await clientReplies(o2, "Do you audit smart contracts?");
  await tickUntilIdle(advanceSalesRun, run.id, deps(email));

  assert.equal(email.sent.length, 0, "neither is sent automatically");
  const [a1] = await actionsFor(run.id, haggler.id, "send_reply");
  const [a2] = await actionsFor(run.id, crypto.id, "send_reply");
  assert.equal(a1.status, "pending");
  assert.ok(a1.escalations.includes("sensitive"));
  assert.equal(a2.status, "pending");
  assert.ok(a2.escalations.includes("not_in_knowledge"));
  assert.match(a2.evidence.theyWrote, /smart contracts/, "the approval shows what they wrote");
});

test("Unsubscribe: no reply, conversation closed, and no follow-ups ever", async (t) => {
  if (!ready) return t.skip("database not reachable");
  const campaign = await createCampaign(user.id, { name: "Unsubscribe test" });
  const { lead, outreach } = await emailedLead(campaign, "Quiet Co");
  const run = await createRun(user.id, campaign.id, { mode: "autopilot" });
  const email = fakeEmail();

  await clientReplies(outreach, "Please stop emailing us.");
  await tickUntilIdle(advanceSalesRun, run.id, deps(email));

  assert.equal(email.sent.length, 0);
  const saved = await getLead(lead.id);
  assert.equal(saved.conversationStatus, "unsubscribed");
  assert.equal(saved.nextFollowUpAt, null);
  assert.equal((await actionsFor(run.id, lead.id, "close_conversation")).length, 1);

  // Even if they write again, the agent doesn't answer
  await clientReplies(outreach, "Also, what do you do?");
  await tickUntilIdle(advanceSalesRun, run.id, deps(email));
  assert.equal(email.sent.length, 0);
  assert.equal((await actionsFor(run.id, lead.id, "send_reply")).length, 0);
});

test("Out of office: no reply; the follow-up waits until they're back", async (t) => {
  if (!ready) return t.skip("database not reachable");
  const campaign = await createCampaign(user.id, { name: "Away test" });
  const { lead, outreach } = await emailedLead(campaign, "Away Co");
  const run = await createRun(user.id, campaign.id, { mode: "autopilot" });
  const email = fakeEmail();

  await clientReplies(outreach, "I am out of the office until next week.");
  await tickUntilIdle(advanceSalesRun, run.id, deps(email));

  assert.equal(email.sent.length, 0);
  const saved = await getLead(lead.id);
  assert.equal(saved.conversationStatus, "awaiting_reply");
  assert.ok(new Date(saved.nextFollowUpAt) > new Date(`${DAY}T00:00:00Z`), "after their return date");
});

// ─── Follow-ups ───

test("Follow-ups: two nudges in the same thread, then the lead is closed as no response", async (t) => {
  if (!ready) return t.skip("database not reachable");
  const campaign = await createCampaign(user.id, { name: "Follow-up test" });
  const { lead, outreach } = await emailedLead(campaign, "Silent Co");
  const run = await createRun(user.id, campaign.id, { mode: "autopilot" });
  const email = fakeEmail();
  const due = () => db.update(leads).set({ nextFollowUpAt: new Date(Date.now() - 60000) }).where(eq(leads.id, lead.id));

  await due();
  await tickUntilIdle(advanceSalesRun, run.id, deps(email));
  assert.equal(email.sent.length, 1, "first follow-up");
  assert.equal(email.sent[0].inReplyTo, outreach.emailMessageId, "in the same thread");
  assert.equal(email.sent[0].subject, `Re: ${outreach.subject}`);
  let saved = await getLead(lead.id);
  assert.equal(saved.followUpsSent, 1);
  const gap = (new Date(saved.nextFollowUpAt) - Date.now()) / 86400000;
  assert.ok(gap > 3.9 && gap < 4.1, `second one 4 days later (day 7), got ${gap}`);

  await due();
  await tickUntilIdle(advanceSalesRun, run.id, deps(email));
  assert.equal(email.sent.length, 2, "second (last) follow-up");
  assert.match(email.sent[1].body, /won't keep writing/);

  await due();
  await tickUntilIdle(advanceSalesRun, run.id, deps(email));
  assert.equal(email.sent.length, 2, "no third email");
  saved = await getLead(lead.id);
  assert.equal(saved.conversationStatus, "no_response");
  assert.equal((await getRun(run.id)).status, "completed");
});

test("A reply withdraws a follow-up that was waiting for approval", async (t) => {
  if (!ready) return t.skip("database not reachable");
  const campaign = await createCampaign(user.id, { name: "Withdraw test" });
  const { lead, outreach } = await emailedLead(campaign, "Late Co");
  const run = await createRun(user.id, campaign.id, { mode: "assisted" });
  const email = fakeEmail();

  await db.update(leads).set({ nextFollowUpAt: new Date(Date.now() - 60000) }).where(eq(leads.id, lead.id));
  await tickUntilIdle(advanceSalesRun, run.id, deps(email));
  const [followUp] = await actionsFor(run.id, lead.id, "send_follow_up");
  assert.equal(followUp.status, "pending");

  await clientReplies(outreach, "Sorry for the delay, we're interested.");
  await tickUntilIdle(advanceSalesRun, run.id, deps(email));

  const [withdrawn] = await db.select().from(agentActions).where(eq(agentActions.id, followUp.id));
  assert.equal(withdrawn.status, "superseded");
  const draft = (await threadOf(lead.id)).find((m) => m.id === followUp.payload.draftId);
  assert.equal(draft.status, "discarded");
  assert.equal((await actionsFor(run.id, lead.id, "send_reply"))[0].status, "pending", "their reply is answered instead");
  assert.equal(email.sent.length, 0);
});
