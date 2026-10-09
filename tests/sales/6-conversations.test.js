// Conversations (step 6): replies matched, read and answered from the knowledge base, follow-ups, LinkedIn replies.
// Combined from the section's test files; each keeps its own setup inside its describe block.
// Run: npm run test:sales:conversations   (or: npx tsx --test tests/sales/6-conversations.test.js)
import "../../libs/load-env"; // first: the database client reads DATABASE_URL when it loads
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { decideAction } from "../../libs/agent/actions";
import { db } from "../../libs/db";
import { advanceSalesRun } from "../../libs/sales/agent/sales-agent";
import { fillPlaceholders, followUpPrompt, replyPrompt } from "../../libs/sales/conversation/compose";
import { planReply, proposedTime, REPLY_ESCALATION, REPLY_PLAN, replyAddress } from "../../libs/sales/conversation/decide";
import { normaliseReading, readReplyPrompt } from "../../libs/sales/conversation/read-reply";
import { CONVERSATION_STATUS, INTENT } from "../../libs/sales/conversation/status";
import { nextFollowUpAt, recordOutbound, replySubject, threadReferences } from "../../libs/sales/conversation/thread";
import { isIgnorable, matchReply, normaliseSubject, parseIdList, stripQuotedReply } from "../../libs/sales/inbox/match";
import { recordReply, syncSalesInbox, wakeForReply } from "../../libs/sales/inbox/sync";
import { findConversation, lastIsOurs, newInbound, syncLinkedInReplies } from "../../libs/sales/linkedin-inbox";
import { zonedTime } from "../../libs/sales/meetings/slots";
import { agentActions, agentRuns, conversationMessages, leads, meetings } from "../../libs/schema";
import { closeDatabase, createCampaign, createCompanyLead, createRun, createUser, databaseReady, fakeEmail, fakeNotify, getLead, getRun, nextWeekday, removeUser, resetLlm, tickUntilIdle, useFakeLlm } from "./helpers/fixtures";

// ─── Replies: matching, reading, planning, writing (was conversation.test.js) ───
// ─── Matching replies to what we sent ───
describe("Replies: matching, reading, planning, writing", () => {
  test("message ids are pulled out of In-Reply-To / References headers", () => {
    assert.deepEqual(parseIdList("<a@x.com> <b@y.com>"), ["<a@x.com>", "<b@y.com>"]);
    assert.deepEqual(parseIdList(["<a@x.com>", "<c@z>"]), ["<a@x.com>", "<c@z>"]);
    assert.deepEqual(parseIdList(null), []);
  });

  test("subjects compare without Re:/Fwd: chains and the test tag", () => {
    assert.equal(normaliseSubject("Re: RE: Fwd: [TEST] Faster React hiring at Zoho"), "faster react hiring at zoho");
    assert.equal(normaliseSubject("AW: Quick question"), "quick question");
  });

  const sent = [
    { id: "s1", emailMessageId: "<one@raasta>", subject: "Faster React hiring", toAddress: "hr@zoho.com", sentAt: "2026-10-01T10:00:00Z" },
    { id: "s2", emailMessageId: null, subject: "Help with your Flutter roles", toAddress: "ceo@abs.pk", sentAt: "2026-10-02T10:00:00Z" },
  ];
  const now = new Date("2026-10-06T10:00:00Z");

  test("a reply is matched by its thread headers first", () => {
    const m = matchReply({ from: "someone@else.com", subject: "whatever", inReplyTo: "<one@raasta>" }, sent, { now });
    assert.equal(m.row.id, "s1");
    assert.equal(m.by, "thread");
    assert.equal(matchReply({ from: "x@y.com", subject: "x", references: "<zzz@q> <one@raasta>" }, sent, { now }).row.id, "s1");
  });

  test("without headers, the subject matches only from the address we wrote to", () => {
    assert.equal(matchReply({ from: "CEO@abs.pk", subject: "Re: Help with your Flutter roles" }, sent, { now }).row.id, "s2");
    assert.equal(matchReply({ from: "stranger@spam.com", subject: "Re: Help with your Flutter roles" }, sent, { now }), null);
  });

  test("in test mode, the test recipient's replies match by subject", () => {
    const m = matchReply({ from: "nomi@gmail.com", subject: "Re: [TEST] Help with your Flutter roles" }, sent, { testRecipient: "Nomi@gmail.com", now });
    assert.equal(m.row.id, "s2");
  });

  test("old emails and unrelated mail are not matched", () => {
    assert.equal(matchReply({ from: "hr@zoho.com", subject: "Re: Faster React hiring" }, sent, { now: new Date("2027-06-01"), maxAgeDays: 90 }), null);
    assert.equal(matchReply({ from: "hr@zoho.com", subject: "Lunch on Friday?" }, sent, { now }), null);
  });

  test("bounces and our own mail are ignored", () => {
    assert.equal(isIgnorable({ from: "MAILER-DAEMON@googlemail.com" }, { ownAddress: "me@x.com" }), true);
    assert.equal(isIgnorable({ from: "me@x.com" }, { ownAddress: "ME@x.com" }), true);
    assert.equal(isIgnorable({ from: "hr@zoho.com" }, { ownAddress: "me@x.com" }), false);
  });

  test("only the new text of a reply is kept", () => {
    const gmail = "Sounds good, what does it cost?\n\nThanks,\nAli\n\nOn Mon, 6 Oct 2026 at 10:00, Nouman <me@x.com>\nwrote:\n> Hi Ali,\n> We build apps.";
    assert.equal(stripQuotedReply(gmail), "Sounds good, what does it cost?\n\nThanks,\nAli");
    const outlook = "Yes please.\n\nFrom: Nouman <me@x.com>\nSent: Monday\nSubject: hi\n\nold text";
    assert.equal(stripQuotedReply(outlook), "Yes please.");
    assert.equal(stripQuotedReply("Interested!\n-- \nAli Khan\nCTO"), "Interested!");
    assert.equal(stripQuotedReply("Call me\n\n[Test email: this would have gone to hr@zoho.com]\nHi"), "Call me");
  });

  // ─── Reading a reply ───

  test("the reading prompt carries today's date, our zone and the times we offered", () => {
    const { user, system } = readReplyPrompt({
      reply: "Tuesday works", ourLastEmail: "Here are some times",
      offeredSlots: [{ start: "2026-10-13T06:00:00Z" }], timeZone: "Asia/Karachi", now,
    });
    assert.match(user, /Today is Tuesday,? 6 October 2026/);
    assert.match(user, /Pakistan time \(UTC\+5\)/);
    assert.match(user, /1\. Tuesday 13 October, 11:00 AM/);
    assert.match(system, /pick_slot/);
  });

  test("a reading is normalised: unknown intents, bad dates and out-of-range slots are dropped", () => {
    const r = normaliseReading({ intent: "buy_now", confidence: 3, sentiment: "angry", proposedStart: "tomorrow", chosenSlot: 5, questions: ["  a? ", ""], contactName: "Ali Khan" }, { offeredCount: 3 });
    assert.equal(r.intent, INTENT.OTHER);
    assert.equal(r.confidence, 1);
    assert.equal(r.sentiment, "neutral");
    assert.equal(r.proposedStart, null);
    assert.equal(r.chosenSlot, null);
    assert.deepEqual(r.questions, ["a?"]);
    assert.equal(r.contactName, "Ali");
    const ok = normaliseReading({ intent: "pick_slot", confidence: 0.9, chosenSlot: 2, proposedStart: "2026-10-14T15:00:00", proposedTimeZone: "Europe/London" }, { offeredCount: 3 });
    assert.equal(ok.chosenSlot, 2);
    assert.equal(ok.proposedStart, "2026-10-14T15:00");
    assert.equal(ok.proposedTimeZone, "Europe/London");
  });

  // ─── Deciding what to do ───

  const reading = (over) => normaliseReading({ intent: "question", confidence: 0.9, sentiment: "neutral", ...over });

  test("a question is answered; a time they ask for is booked when free", () => {
    assert.equal(planReply({ reading: reading() }).plan, REPLY_PLAN.ANSWER);
    assert.equal(planReply({ reading: reading() }).nextStatus, CONVERSATION_STATUS.IN_CONVERSATION);
    const start = new Date("2026-10-14T10:00:00Z");
    const booked = planReply({ reading: reading({ intent: "meeting" }), proposed: { start, free: true } });
    assert.equal(booked.plan, REPLY_PLAN.CONFIRM);
    assert.equal(booked.start.getTime(), start.getTime());
    assert.equal(booked.nextStatus, CONVERSATION_STATUS.MEETING_BOOKED);
    // A question with a time in it still books the time
    assert.equal(planReply({ reading: reading(), proposed: { start, free: true } }).plan, REPLY_PLAN.CONFIRM);
  });

  test("interest or a meeting request without a time gets times offered", () => {
    for (const intent of ["interested", "meeting", "reschedule"]) {
      const d = planReply({ reading: reading({ intent }) });
      assert.equal(d.plan, REPLY_PLAN.OFFER, intent);
      assert.equal(d.nextStatus, CONVERSATION_STATUS.MEETING_PROPOSED);
    }
  });

  test("a time that isn't free gets other times, and a person is asked", () => {
    const d = planReply({ reading: reading({ intent: "meeting" }), proposed: { start: new Date(), free: false } });
    assert.equal(d.plan, REPLY_PLAN.OFFER);
    assert.ok(d.escalations.includes(REPLY_ESCALATION.TIME_UNAVAILABLE));
  });

  test("no, stop and away get no email back", () => {
    const no = planReply({ reading: reading({ intent: "not_interested", sentiment: "negative" }) });
    assert.deepEqual([no.plan, no.send, no.nextStatus, no.escalations], [REPLY_PLAN.CLOSE, false, CONVERSATION_STATUS.NOT_INTERESTED, []]);
    assert.equal(planReply({ reading: reading({ intent: "unsubscribe" }) }).nextStatus, CONVERSATION_STATUS.UNSUBSCRIBED);
    const away = planReply({ reading: reading({ intent: "out_of_office", returnDate: "2026-10-20" }), now });
    assert.equal(away.plan, REPLY_PLAN.WAIT);
    assert.equal(away.followUpAt.toISOString().slice(0, 10), "2026-10-21");
    const awayNoDate = planReply({ reading: reading({ intent: "out_of_office" }), now });
    assert.equal(awayNoDate.followUpAt.toISOString().slice(0, 10), "2026-10-11");
  });

  test("not now gets a short polite close", () => {
    const d = planReply({ reading: reading({ intent: "not_now" }) });
    assert.deepEqual([d.plan, d.send, d.nextStatus], [REPLY_PLAN.NOT_NOW, true, CONVERSATION_STATUS.NOT_INTERESTED]);
  });

  test("unclear, unhappy or sensitive replies always go to a person", () => {
    assert.ok(planReply({ reading: reading({ confidence: 0.3 }) }).escalations.includes(REPLY_ESCALATION.UNCLEAR));
    assert.ok(planReply({ reading: reading({ intent: "other" }) }).escalations.includes(REPLY_ESCALATION.UNCLEAR));
    assert.ok(planReply({ reading: reading({ sentiment: "negative" }) }).escalations.includes(REPLY_ESCALATION.NEGATIVE));
    assert.ok(planReply({ reading: reading({ sensitive: true }) }).escalations.includes(REPLY_ESCALATION.SENSITIVE));
    assert.deepEqual(planReply({ reading: reading() }).escalations, []);
  });

  test("the time they mean: a picked slot, else their time in their zone or ours", () => {
    const offered = [{ start: "2026-10-13T06:00:00Z" }, { start: "2026-10-14T10:00:00Z" }];
    assert.equal(proposedTime({ ...reading(), chosenSlot: 2 }, { offeredSlots: offered, timeZone: "Asia/Karachi", zonedTime }).toISOString(), "2026-10-14T10:00:00.000Z");
    const r = normaliseReading({ intent: "meeting", proposedStart: "2026-10-14T15:00" });
    assert.equal(proposedTime(r, { timeZone: "Asia/Karachi", zonedTime }).toISOString(), "2026-10-14T10:00:00.000Z");
    const london = normaliseReading({ intent: "meeting", proposedStart: "2026-10-14T15:00", proposedTimeZone: "Europe/London" });
    assert.equal(proposedTime(london, { timeZone: "Asia/Karachi", zonedTime }).toISOString(), "2026-10-14T14:00:00.000Z"); // BST
    assert.equal(proposedTime(reading(), { timeZone: "Asia/Karachi", zonedTime }), null);
  });

  test("our answer goes to whoever replied, or the original address while test mode redirects", () => {
    const thread = [
      { direction: "out", toAddress: "hr@zoho.com" },
      { direction: "in", fromAddress: "ali@zoho.com" },
    ];
    assert.equal(replyAddress(thread), "ali@zoho.com");
    const test = [{ direction: "out", toAddress: "hr@zoho.com" }, { direction: "in", fromAddress: "nomi@gmail.com" }];
    assert.equal(replyAddress(test, { testRecipient: "NOMI@gmail.com" }), "hr@zoho.com");
  });

  // ─── Writing ───

  test("times and meeting details are filled in by code, never by the AI", () => {
    const slots = [{ start: new Date("2026-10-13T06:00:00Z") }, { start: new Date("2026-10-14T10:00:00Z") }];
    const offer = fillPlaceholders("Hi Ali,\n\nHappy to talk. Any of these?\n{{TIMES}}\n\nNouman", { plan: REPLY_PLAN.OFFER, slots, timeZone: "Asia/Karachi" });
    assert.match(offer, /- Tuesday 13 October, 11:00 AM\n- Wednesday 14 October, 3:00 PM\n\(All times Pakistan time \(UTC\+5\)\.\)/);
    assert.ok(offer.endsWith("Nouman"));
    // Placeholder forgotten: the times go in before the sign-off anyway
    const missing = fillPlaceholders("Hi Ali,\n\nWhen suits you?\n\nNouman", { plan: REPLY_PLAN.OFFER, slots, timeZone: "Asia/Karachi" });
    assert.match(missing, /When suits you\?\n\n- Tuesday/);
    assert.ok(missing.endsWith("Nouman"));
    const confirm = fillPlaceholders("Great!\n{{MEETING}}\nTalk soon,\nNouman", { plan: REPLY_PLAN.CONFIRM, meeting: { start: slots[1].start, minutes: 30, link: "https://meet.google.com/abc" }, timeZone: "Asia/Karachi" });
    assert.match(confirm, /Wednesday 14 October, 3:00 PM Pakistan time \(UTC\+5\), 30 minutes\nJoin here: https:\/\/meet\.google\.com\/abc/);
    assert.equal(fillPlaceholders("Answer {{TIMES}} here", { plan: REPLY_PLAN.ANSWER }), "Answer here");
  });

  test("reply and follow-up prompts are grounded in the knowledge base", () => {
    const { system, user } = replyPrompt({
      plan: REPLY_PLAN.OFFER, reply: "How much is an app?", reading: reading({ questions: ["How much is an app?"], contactName: "Ali" }),
      thread: [{ direction: "out", body: "We build apps" }], passages: [{ title: "Pricing", content: "Apps from $8,000" }],
      companyName: "Acme Dev", senderName: "Nouman Ahmed", timeZone: "Asia/Karachi",
    });
    assert.match(system, /Acme Dev/);
    assert.match(system, /ONLY facts/);
    assert.match(system, /\{\{TIMES\}\}/);
    assert.match(system, /Sign off with: Nouman$/m);
    assert.match(user, /\[1\] Pricing\nApps from \$8,000/);
    assert.match(user, /US: We build apps/);
    assert.match(user, /Their first name: Ali/);
    const last = followUpPrompt({ number: 2, total: 2, thread: [], companyName: "Acme Dev" });
    assert.match(last.system, /last one/);
    assert.match(followUpPrompt({ number: 1, total: 2, thread: [] }).system, /one new, useful reason/);
  });

  // ─── Thread helpers ───

  test("follow-ups are spaced from the first email and stop when used up", () => {
    const sentAt = "2026-10-01T10:00:00Z";
    assert.equal(nextFollowUpAt(sentAt, 0, [3, 7]).toISOString(), "2026-10-04T10:00:00.000Z");
    assert.equal(nextFollowUpAt("2026-10-04T10:00:00Z", 1, [3, 7]).toISOString(), "2026-10-08T10:00:00.000Z");
    assert.equal(nextFollowUpAt(sentAt, 2, [3, 7]), null);
  });

  test("our next email keeps the thread: Re: subject and every Message-ID", () => {
    const thread = [
      { subject: "[TEST] Faster hiring", emailMessageId: "<a@x>" },
      { subject: "Re: [TEST] Faster hiring", emailMessageId: "<b@y>" },
      { subject: null, emailMessageId: null },
    ];
    assert.equal(replySubject(thread), "Re: Faster hiring");
    assert.equal(replySubject([{ subject: "[TEST] Faster hiring" }]), "Re: Faster hiring");
    assert.deepEqual(threadReferences(thread), ["<a@x>", "<b@y>"]);
  });

  test("we never greet the client with our own name; on LinkedIn their profile name is used (greeted Nouman as 'Hi QA')", async () => {
    const { contactNameFor } = await import("../../libs/sales/conversation/reply");
    const lead = { source: "linkedin", name: "Nouman Ahmed", sourceData: { profile: { name: "Nouman Ahmed" } } };
    const inbound = { channel: "linkedin" };
    assert.equal(contactNameFor({ reading: { contactName: "QA" }, lead, inbound, senderName: "QA Tester" }), "Nouman", "our sign-off isn't their name");
    assert.equal(contactNameFor({ reading: { contactName: null }, lead, inbound, senderName: "QA Tester" }), "Nouman");
    assert.equal(contactNameFor({ reading: { contactName: "Ali" }, lead: { source: "rozee", company: "Acme" }, inbound: { channel: "email" }, senderName: "QA" }), "Ali", "a name they signed with is kept");
    assert.equal(contactNameFor({ reading: { contactName: "QA" }, lead: { source: "rozee", company: "Acme" }, inbound: { channel: "email" }, senderName: "QA" }), null, "an email with no name: no name");
  });
});

// ─── Replies on LinkedIn (added after the LinkedIn meeting test) ───
describe("Replies on LinkedIn", () => {
  test("a meeting confirmed on LinkedIn never claims a calendar invite is attached", () => {
    const email = replyPrompt({ plan: REPLY_PLAN.CONFIRM, reply: "Monday works", passages: [], timeZone: "Asia/Karachi" });
    const linkedin = replyPrompt({ plan: REPLY_PLAN.CONFIRM, reply: "Monday works", passages: [], timeZone: "Asia/Karachi", channel: "linkedin" });
    assert.match(email.system, /calendar invite is attached/);
    assert.doesNotMatch(linkedin.system, /calendar invite is attached/);
    assert.match(linkedin.system, /LinkedIn message/);
    assert.match(linkedin.system, /Never mention a calendar invite/);
  });
});

// ─── Conversations end to end (database) (was conversation-flow.integration.test.js) ───
// Integration: replies, answers, meetings and follow-ups against the real database.
// The mailbox, the AI and email are fakes (the real prompt building, parsing, decisions, slot
// finding and calendar invites all run). Repeats the manual test where a reply to the Zoho email
// ("price? NDA? Monday 3pm?") was answered from the knowledge base and the meeting was booked.
describe("Conversations end to end (database)", () => {
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
    // Nothing left open, but the agent keeps watching for replies until a person stops it
    const after = await getRun(run.id);
    assert.equal(after.status, "waiting", "still active: a later reply is answered too");
    assert.ok(after.results.allDoneAt, "the person was told the outreach is done");
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
    assert.equal((await getRun(run.id)).status, "waiting", "stays active until stopped by hand");
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
});

// ─── LinkedIn replies (was linkedin-inbox.test.js) ───
// LinkedIn replies (libs/sales/linkedin-inbox.js): the parts that don't need a browser. The shapes
// are from the live messaging page of 9 Oct 2026 (LinkedIn keeps its msg-* markup there).
describe("LinkedIn replies", () => {
  test("the conversation is found by the person's name; a 'You:' preview means nothing new", () => {
    const items = [{ name: "Ali Khan", snippet: "Ali: Sounds good" }, { name: "Nouman  Ahmed", snippet: "You: Hi Nouman, I saw your post…" }];
    assert.equal(findConversation(items, "nouman ahmed"), 1);
    assert.equal(findConversation(items, "Sara"), -1);
    assert.equal(findConversation(items, ""), -1);
    assert.equal(lastIsOurs(items[1]), true);
    assert.equal(lastIsOurs(items[0]), false);
  });

  test("only the person's messages after our first message count as replies", () => {
    const events = [
      { sender: "Nouman Ahmed", urn: "u0", text: "Old chat from last year" },
      { sender: "Anisa Malik", urn: "u1", text: "Hi Nouman, I saw your post…" },
      { sender: "Nouman Ahmed", urn: "u2", text: "Thanks! What do you charge?" },
      { sender: "Nouman Ahmed", urn: "u3", text: "  " },
      { sender: "Nouman Ahmed", urn: "u4", text: "Also, can we talk Tuesday?" },
    ];
    assert.deepEqual(newInbound(events, "Nouman Ahmed").map((e) => e.urn), ["u2", "u4"]);
    assert.deepEqual(newInbound([{ sender: "Nouman Ahmed", urn: "x", text: "hi" }], "Nouman Ahmed"), [], "we never wrote: nothing is a reply");
  });
});

// ─── A LinkedIn conversation (database) (was linkedin-conversation.integration.test.js) ───
// Integration: a LinkedIn conversation. Our LinkedIn message starts the thread, the person's reply is
// read (browser faked) and recorded once, and the agent answers it from the knowledge base ON LINKEDIN
// (LinkedIn sending faked). Real database, fake AI.
describe("A LinkedIn conversation (database)", () => {
  let ready = false;
  let user;
  before(async () => {
    ready = await databaseReady();
    if (!ready) return;
    user = await createUser({ name: "Nouman Ahmed" });
    useFakeLlm([
      { when: (system) => system.includes("You read a client's reply"), reply: () => ({ intent: "question", questions: ["What do you charge?"], confidence: 0.95, sentiment: "positive", sensitive: false, contactName: "Sara", summary: "asks the price" }) },
      { when: (system) => system.includes("You write email replies"), reply: () => ({ body: "Hi Sara,\n\nA senior developer is from $4,000 per month.\n\nNouman", covered: true, sources: [1] }) },
    ]);
  });
  after(async () => {
    resetLlm();
    if (user) await removeUser(user.id);
  });

  const passages = async () => ({ results: [{ id: "p1", title: "Pricing", category: "pricing", content: "Senior developer from $4,000 per month.", similarity: 0.7 }], topSimilarity: 0.7 });

  test("a LinkedIn reply is read once, and the agent answers it on LinkedIn", async (t) => {
    if (!ready) return t.skip("database not reachable");
    const campaign = await createCampaign(user.id, { name: "LinkedIn conversation", sources: ["linkedin"] });
    const profile = "https://www.linkedin.com/in/sara-test";
    const [lead] = await db.insert(leads).values({ userId: user.id, campaignId: campaign.id, source: "linkedin", url: profile, name: "Sara Ahmed", status: "completed", messageSent: true, sourceData: { profile: { name: "Sara Ahmed" } } }).returning();
    await recordOutbound({ lead, kind: "outreach", channel: "linkedin", subject: null, body: "Hi Sara, saw your post.", toAddress: profile, sent: { messageId: null }, followUpDays: [3, 7] });
    assert.equal((await getLead(lead.id)).conversationStatus, "awaiting_reply", "our LinkedIn message starts the conversation");

    // The reader (browser) is faked: Sara wrote one message
    const asked = [];
    const read = async (account, people) => {
      asked.push(...people.map((p) => p.name));
      return [{ leadId: lead.id, messages: [{ urn: "urn:li:msg_message:test-1", text: "Thanks! What do you charge?" }] }];
    };
    const woke = [];
    const first = await syncLinkedInReplies({ id: "acc" }, campaign.id, { read, wake: async (r) => woke.push(r.row.id) });
    assert.deepEqual([first.checked, first.replies, asked], [1, 1, ["Sara Ahmed"]]);
    const again = await syncLinkedInReplies({ id: "acc" }, campaign.id, { read, wake: async () => {} });
    assert.equal(again.replies, 0, "the same LinkedIn message is never recorded twice");
    assert.equal(woke.length, 1);
    assert.equal((await getLead(lead.id)).conversationStatus, "replied");

    // The agent answers in Auto, on LinkedIn, from its account
    const sentOnLinkedIn = [];
    const email = fakeEmail();
    const run = await createRun(user.id, campaign.id, { mode: "autopilot", config: { accountId: "acc" } });
    await tickUntilIdle(advanceSalesRun, run.id, {
      tick: async () => {}, notifyFn: fakeNotify().fn, emailFn: email.send, conversation: { searchFn: passages },
      linkedinRepliesFn: async () => ({ checked: 0, replies: 0 }),
      linkedin: {
        getLinkedInAccount: async () => ({ id: "acc" }), linkedInAllowance: async () => ({ invites: 5, messages: 5 }), checkAcceptances: async () => null,
        sendLinkedInMessage: async (account, msg) => { sentOnLinkedIn.push(msg); return { success: true }; },
      },
    });
    assert.equal(email.sent.length, 0, "no email for a LinkedIn conversation");
    assert.equal(sentOnLinkedIn.length, 1);
    assert.equal(sentOnLinkedIn[0].url, profile);
    assert.match(sentOnLinkedIn[0].message, /\$4,000 per month/);
    const thread = await db.select().from(conversationMessages).where(eq(conversationMessages.leadId, lead.id)).orderBy(conversationMessages.createdAt);
    assert.deepEqual(thread.map((m) => [m.direction, m.channel, m.kind, m.status]), [
      ["out", "linkedin", "outreach", "sent"], ["in", "linkedin", "inbound", "received"], ["out", "linkedin", "reply", "sent"],
    ]);
    assert.equal((await getLead(lead.id)).conversationStatus, "in_conversation");
  });
});

// One database connection for the whole file: closed after every section has run
after(async () => {
  await closeDatabase();
});
