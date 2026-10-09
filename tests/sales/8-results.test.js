// Results (step 8): the funnel and the numbers.
// Combined from the section's test files; each keeps its own setup inside its describe block.
// Run: npm run test:sales:results   (or: npx tsx --test tests/sales/8-results.test.js)
import "../../libs/load-env"; // first: the database client reads DATABASE_URL when it loads
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { db } from "../../libs/db";
import { recordOutbound } from "../../libs/sales/conversation/thread";
import { recordReply } from "../../libs/sales/inbox/sync";
import { computeResults, loadCampaignResults } from "../../libs/sales/results";
import { meetings, messages } from "../../libs/schema";
import { closeDatabase, createCampaign, createCompanyLead, createUser, databaseReady, removeUser } from "./helpers/fixtures";

// ─── Results (was results.test.js) ───
describe("Results", () => {
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
});

// ─── Results from the database (was results.integration.test.js) ───
// Integration: the Results step reads a campaign's real data (leads, messages, threads, meetings).
describe("Results from the database", () => {
  let ready = false;
  let user;
  before(async () => {
    ready = await databaseReady();
    if (ready) user = await createUser();
  });
  after(async () => {
    if (user) await removeUser(user.id);
  });

  test("results add up a campaign's emails, replies and meetings", async (t) => {
    if (!ready) return t.skip("database not reachable");
    const campaign = await createCampaign(user.id, { name: "Results test" });
    const sourceData = { research: { status: "found" }, fit: { score: 75 } };
    const replied = await createCompanyLead(user.id, campaign.id, { company: "Reply Co", messageSent: true, sourceData });
    const quiet = await createCompanyLead(user.id, campaign.id, { company: "Quiet Co", messageSent: true, sourceData });
    await createCompanyLead(user.id, campaign.id, { company: "New Co" });
    for (const lead of [replied, quiet]) {
      await db.insert(messages).values({ userId: user.id, leadId: lead.id, campaignId: campaign.id, source: "indeed", channel: "email", status: "sent", content: "Hi", model: "fake" });
    }
    const outreach = await recordOutbound({ lead: replied, kind: "outreach", subject: "Hello", body: "Hi", toAddress: "hr@reply.test", sent: { messageId: `<r-${replied.id}@t>` } });
    await recordOutbound({ lead: quiet, kind: "outreach", subject: "Hello", body: "Hi", toAddress: "hr@quiet.test", sent: { messageId: `<q-${quiet.id}@t>` } });
    await recordReply({ mail: { messageId: `<in-${replied.id}@c>`, inReplyTo: outreach.emailMessageId, from: "hr@reply.test", subject: "Re: Hello", text: "Let's talk", date: new Date() }, sentRow: outreach, by: "thread" });
    await db.insert(meetings).values({ userId: user.id, leadId: replied.id, campaignId: campaign.id, status: "confirmed", title: "Call", timezone: "Asia/Karachi", startAt: new Date(), endAt: new Date() });

    const results = await loadCampaignResults(campaign.id);
    const k = results.platforms.indeed.kpis;
    assert.equal(results.campaign.name, "Results test");
    assert.deepEqual([k.leads, k.contacted, k.replied, k.replyRate, k.meetings], [3, 2, 1, 50, 1]);
    assert.deepEqual(results.platforms.indeed.funnel.map((s) => s.count), [3, 2, 2, 2, 2, 1, 1]);
    const today = results.platforms.indeed.series.at(-1);
    assert.deepEqual([today.sent, today.replies], [2, 1]);
  });
});

// One database connection for the whole file: closed after every section has run
after(async () => {
  await closeDatabase();
});
