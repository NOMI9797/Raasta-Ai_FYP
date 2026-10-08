import { test } from "node:test";
import assert from "node:assert/strict";
import { computeResults } from "../../libs/sales/results";

const now = new Date("2026-10-07T12:00:00Z");
const company = (id, over = {}) => ({ id, source: "indeed", messageSent: false, sourceData: {}, conversationStatus: null, ...over });
const researched = (score) => ({ research: { status: "found" }, fit: { score } });

// 5 companies: 4 researched, 3 good fits, 3 written, 3 contacted, 2 replied, 1 meeting
const leads = [
  company("a", { sourceData: researched(80), messageSent: true, conversationStatus: "meeting_booked" }),
  company("b", { sourceData: researched(65), messageSent: true, conversationStatus: "in_conversation" }),
  company("c", { sourceData: researched(55), messageSent: true, conversationStatus: "awaiting_reply" }),
  company("d", { sourceData: researched(30) }),
  company("e"),
];
const thread = [
  { leadId: "a", direction: "out", kind: "outreach", status: "sent", sentAt: "2026-10-05T10:00:00Z" },
  { leadId: "a", direction: "in", kind: "inbound", status: "received", intent: "meeting", receivedAt: "2026-10-05T14:00:00Z" },
  { leadId: "b", direction: "out", kind: "outreach", status: "sent", sentAt: "2026-10-06T10:00:00Z" },
  { leadId: "b", direction: "in", kind: "inbound", status: "received", intent: "question", receivedAt: "2026-10-06T18:00:00Z" },
  { leadId: "c", direction: "out", kind: "outreach", status: "sent", sentAt: "2026-10-03T10:00:00Z" },
  { leadId: "c", direction: "out", kind: "follow_up", status: "sent", sentAt: "2026-10-06T10:00:00Z" },
  { leadId: "c", direction: "out", kind: "follow_up", status: "draft", sentAt: null },
];
const meetings = [{ leadId: "a", status: "confirmed" }, { leadId: "b", status: "proposed" }];
const out = computeResults({ leads, written: new Set(["a", "b", "c"]), thread, meetings, now, days: 7 });
const r = out.platforms.indeed;

test("KPIs: contacted, reply rate, meetings, follow-ups, time to reply", () => {
  assert.deepEqual(r.kpis, {
    leads: 5, contacted: 3, contactRate: 60, replied: 2, replyRate: 66.7, meetings: 1, meetingRate: 33.3,
    followUps: 1, medianHoursToReply: 6, // 4 h and 8 h
  });
});

test("company funnel with the share of all leads and of the step before", () => {
  assert.deepEqual(r.funnel.map((s) => [s.key, s.count]), [["found", 5], ["researched", 4], ["fit", 3], ["written", 3], ["contacted", 3], ["replied", 2], ["meeting", 1]]);
  const replied = r.funnel.find((s) => s.key === "replied");
  assert.equal(replied.ofTotal, 40);
  assert.equal(replied.ofPrevious, 66.7);
  assert.equal(r.funnel[0].ofPrevious, 100);
});

test("only booked meetings count, not offered times", () => {
  assert.equal(r.funnel.find((s) => s.key === "meeting").count, 1);
});

test("activity per day covers the window, counting sent emails and replies", () => {
  assert.equal(r.series.length, 7);
  assert.equal(r.series.at(-1).day, "2026-10-07");
  const oct6 = r.series.find((d) => d.day === "2026-10-06");
  assert.deepEqual([oct6.sent, oct6.replies], [2, 1]);
  assert.equal(r.series.reduce((a, d) => a + d.sent, 0), 4, "drafts are not counted");
});

test("reply intents, outcomes of contacted leads, and lead quality", () => {
  assert.deepEqual(r.intents, { meeting: 1, question: 1 });
  assert.deepEqual(r.outcomes, { meeting_booked: 1, in_conversation: 1, awaiting_reply: 1 });
  assert.deepEqual(r.fit.buckets.map((b) => b.count), [1, 2, 1]);
  assert.equal(r.fit.average, 58);
});

test("LinkedIn people get the person funnel, and platforms are compared", () => {
  const mixed = computeResults({
    leads: [...leads, { id: "p", source: "linkedin", status: "completed", inviteSent: true, inviteStatus: "accepted", messageSent: true, sourceData: {} }],
    thread, meetings, now,
  });
  assert.deepEqual(mixed.platforms.linkedin.funnel.map((s) => s.key), ["added", "profile", "invited", "connected", "contacted", "replied", "meeting"]);
  assert.deepEqual(mixed.comparison.map((c) => [c.platform, c.leads, c.contacted]), [["indeed", 5, 3], ["linkedin", 1, 1]]);
});

test("no leads, no division by zero", () => {
  const empty = computeResults({ leads: [company("x")], now });
  assert.equal(empty.platforms.indeed.kpis.replyRate, 0);
  assert.equal(empty.platforms.indeed.kpis.medianHoursToReply, null);
  assert.equal(empty.platforms.indeed.fit.average, null);
});
