import { test } from "node:test";
import assert from "node:assert/strict";
import { isIgnorable, matchReply, normaliseSubject, parseIdList, stripQuotedReply } from "../../libs/sales/inbox/match";
import { REPLY_ESCALATION, REPLY_PLAN, planReply, proposedTime, replyAddress } from "../../libs/sales/conversation/decide";
import { normaliseReading, readReplyPrompt } from "../../libs/sales/conversation/read-reply";
import { fillPlaceholders, followUpPrompt, replyPrompt } from "../../libs/sales/conversation/compose";
import { nextFollowUpAt, replySubject, threadReferences } from "../../libs/sales/conversation/thread";
import { CONVERSATION_STATUS, INTENT } from "../../libs/sales/conversation/status";
import { zonedTime } from "../../libs/sales/meetings/slots";

// ─── Matching replies to what we sent ───

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
