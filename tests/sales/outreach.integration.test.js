import "../../libs/load-env"; // first: the database client reads DATABASE_URL when it loads
// Integration: the Outreach step for companies against the real database. Sending by hand shares
// the daily limit, starts the thread and follow-up timer, and withdraws the agent's request for the
// same email. Email is a fake; nothing is sent.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../../libs/db";
import { agentActions, agentRuns, conversationMessages, messages } from "../../libs/schema";
import { outreachBoard, sendOutreachEmails } from "../../libs/sales/outreach";
import { closeDatabase, createCampaign, createCompanyLead, createRun, createUser, databaseReady, fakeEmail, getLead, removeUser } from "./helpers/fixtures";

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

async function companyWithEmail(campaign, company, { status = "approved", recipient } = {}) {
  const lead = await createCompanyLead(user.id, campaign.id, { company });
  const [message] = await db.insert(messages).values({
    userId: user.id, leadId: lead.id, campaignId: campaign.id, source: "indeed", channel: "email", status, model: "fake",
    recipient: recipient === undefined ? `hr@${company.toLowerCase().replace(/\s+/g, "")}.test` : recipient,
    subject: `About your ${company} hiring`, content: `Hi ${company} team,\n\nWe can help.\n\nNouman`,
  }).returning();
  return { lead, message };
}

test("the board shows where every company stands", async (t) => {
  if (!ready) return t.skip("database not reachable");
  const campaign = await createCampaign(user.id, { name: "Board test" });
  await companyWithEmail(campaign, "Ready Co");
  await companyWithEmail(campaign, "Draft Co", { status: "draft" });
  await companyWithEmail(campaign, "No Address Co", { recipient: null });
  await createCompanyLead(user.id, campaign.id, { company: "Unwritten Co" });

  const board = await outreachBoard({ campaignId: campaign.id, platform: "indeed" });
  const status = Object.fromEntries(board.companies.map((c) => [c.company, c.status]));
  assert.deepEqual(status, { "Ready Co": "ready", "Draft Co": "not_approved", "No Address Co": "needs_address", "Unwritten Co": "not_written" });
  assert.equal(board.stats.ready, 1);
  assert.deepEqual(board.limit, { limit: 20, sentToday: 0, left: 20 });
});

test("sending by hand: approves drafts, starts the thread, stops at the daily limit", async (t) => {
  if (!ready) return t.skip("database not reachable");
  const campaign = await createCampaign(user.id, { name: "Send test" });
  // The agent works this campaign with a limit of 2 a day, and is asking about one of the emails
  const run = await createRun(user.id, campaign.id, { mode: "assisted", config: { dailyEmailCap: 2 } });
  await db.update(agentRuns).set({ status: "waiting" }).where(eq(agentRuns.id, run.id));
  const a = await companyWithEmail(campaign, "Alpha Co");
  const b = await companyWithEmail(campaign, "Beta Co", { status: "draft" });
  const c = await companyWithEmail(campaign, "Gamma Co");
  const [ask] = await db.insert(agentActions).values({
    agentRunId: run.id, userId: user.id, campaignId: campaign.id, leadId: a.lead.id, action: "send_email", route: "ask",
    status: "pending", summary: "Email Alpha Co", payload: { messageId: a.message.id },
  }).returning();
  const email = fakeEmail();

  const out = await sendOutreachEmails({ user, campaignId: campaign.id, messageIds: [a.message.id, b.message.id, c.message.id] }, { emailFn: email.send });

  assert.equal(out.sent.length, 2, "the agent's limit of 2 applies to hand-sent emails too");
  assert.deepEqual(out.deferred, [c.lead.id]);
  assert.equal(email.sent.length, 2);

  const [draftNow] = await db.select().from(messages).where(eq(messages.id, b.message.id));
  assert.equal(draftNow.status, "sent");
  assert.ok(draftNow.approvedAt, "sending a draft approves it");

  const lead = await getLead(a.lead.id);
  assert.equal(lead.messageSent, true);
  assert.equal(lead.conversationStatus, "awaiting_reply");
  assert.ok(lead.nextFollowUpAt);
  const [thread] = await db.select().from(conversationMessages).where(eq(conversationMessages.leadId, a.lead.id));
  assert.equal(thread.kind, "outreach");
  assert.ok(thread.emailMessageId);

  const [withdrawn] = await db.select().from(agentActions).where(eq(agentActions.id, ask.id));
  assert.equal(withdrawn.status, "superseded", "the agent won't send Alpha's email again");

  const board = await outreachBoard({ campaignId: campaign.id, platform: "indeed" });
  assert.deepEqual(board.limit, { limit: 2, sentToday: 2, left: 0 });
  assert.equal(board.stats.waiting, 2);
  assert.ok(board.agent, "the board says the agent works this campaign");
});

test("a failed send is recorded, and an email without an address isn't tried", async (t) => {
  if (!ready) return t.skip("database not reachable");
  const campaign = await createCampaign(user.id, { name: "Failure test" });
  const broken = await companyWithEmail(campaign, "Broken Co");
  const noAddress = await companyWithEmail(campaign, "Nowhere Co", { recipient: null });
  const emailFn = async () => { throw new Error("SMTP refused the login"); };

  const out = await sendOutreachEmails({ user, campaignId: campaign.id, messageIds: [broken.message.id, noAddress.message.id] }, { emailFn });

  assert.equal(out.sent.length, 0);
  assert.deepEqual(out.failed.map((f) => f.error).sort(), ["Add an email address first", "SMTP refused the login"]);
  assert.equal((await getLead(broken.lead.id)).messageError, "SMTP refused the login");
  const board = await outreachBoard({ campaignId: campaign.id, platform: "indeed" });
  assert.equal(board.companies.find((x) => x.company === "Broken Co").status, "failed");
});
