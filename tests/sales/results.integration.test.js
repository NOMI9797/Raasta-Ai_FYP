import "../../libs/load-env"; // first: the database client reads DATABASE_URL when it loads
// Integration: the Results step reads a campaign's real data (leads, messages, threads, meetings).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../libs/db";
import { meetings, messages } from "../../libs/schema";
import { recordOutbound } from "../../libs/sales/conversation/thread";
import { recordReply } from "../../libs/sales/inbox/sync";
import { loadCampaignResults } from "../../libs/sales/results";
import { closeDatabase, createCampaign, createCompanyLead, createUser, databaseReady, removeUser } from "./helpers/fixtures";

let ready = false;
let user;
before(async () => {
  ready = await databaseReady();
  if (ready) user = await createUser();
});
after(async () => {
  if (user) await removeUser(user.id);
  await closeDatabase();
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
