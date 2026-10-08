// Integration: the sales agent works a campaign end to end against the real database:
// research → score → skip poor fits → write → ask (Semi-auto) or send (Auto) → thread + follow-up timer.
// Research, scoring, writing and email are fakes, so nothing leaves the machine.
// Repeats the manual runs "Agent Test - Indeed Semi-auto" and the Auto run on "Indeed Test Campaign".
import "../../libs/load-env"; // first: the database client reads DATABASE_URL when it loads
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "../../libs/db";
import { agentActions, conversationMessages, leads, messages } from "../../libs/schema";
import { advanceSalesRun } from "../../libs/sales/agent/sales-agent";
import { decideAction } from "../../libs/agent/actions";
import {
  closeDatabase, createCampaign, createCompanyLead, createRun, createUser, databaseReady, fakeEmail, fakeNotify, getLead, getRun, removeUser, tickUntilIdle,
} from "./helpers/fixtures";

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

const FIT = { Acme: 82, "Orbit Labs": 80, "Low Fit Traders": 25, "No Email Ltd": 75 };

/** Fakes for the agent's tools: research finds an email (except for "No Email Ltd"), scoring by name, writing an email. */
function agentDeps(email, notify) {
  return {
    tick: async () => {},
    notifyFn: notify.fn,
    emailFn: email.send,
    researchFn: async (lead) => {
      const found = lead.company === "No Email Ltd" ? [] : [`hr@${lead.company.toLowerCase().replace(/\s+/g, "")}.test`];
      const research = { status: found.length ? "found" : "partial", website: `https://${lead.company.toLowerCase().replace(/\s+/g, "")}.test`, emails: found, phones: [], decisionMakers: [] };
      const [updated] = await db.update(leads).set({ sourceData: { ...lead.sourceData, research } }).where(eq(leads.id, lead.id)).returning();
      return updated;
    },
    scoreFn: async ({ lead }) => ({ score: FIT[lead.company] ?? 60, reason: `Test score for ${lead.company}`, model: "fake", scoredAt: new Date().toISOString() }),
    writeFn: async ({ lead, userId }) => {
      const recipient = lead.sourceData?.research?.emails?.[0] || null;
      const [message] = await db.insert(messages).values({
        userId, leadId: lead.id, campaignId: lead.campaignId, source: lead.source, channel: "email", status: "draft",
        subject: `Help with your ${lead.title} hiring`, recipient, content: `Hi ${lead.company} team,\n\nWe can help.\n\nTest`, model: "fake",
      }).returning();
      return { message };
    },
  };
}

const actionsOf = (runId) => db.select().from(agentActions).where(eq(agentActions.agentRunId, runId));

test("Semi-auto: prepares every lead, skips a poor fit, and asks before sending", async (t) => {
  if (!ready) return t.skip("database not reachable");
  const campaign = await createCampaign(user.id, { name: "Semi-auto test" });
  const acme = await createCompanyLead(user.id, campaign.id, { company: "Acme" });
  const low = await createCompanyLead(user.id, campaign.id, { company: "Low Fit Traders" });
  const nameless = await createCompanyLead(user.id, campaign.id, { company: null, sourceData: { company: {} } });
  const run = await createRun(user.id, campaign.id, { mode: "assisted" });
  const email = fakeEmail();
  const notify = fakeNotify();

  await tickUntilIdle(advanceSalesRun, run.id, agentDeps(email, notify));

  const acts = await actionsOf(run.id);
  const by = (action, leadId) => acts.filter((a) => a.action === action && a.leadId === leadId);
  assert.equal(by("research", acme.id)[0]?.status, "executed", "Acme researched");
  assert.equal(by("score", acme.id)[0]?.result.score, 82, "Acme scored");
  assert.equal(by("skip_lead", low.id).length, 1, "the poor fit (25 < 50) is skipped");
  assert.equal(by("skip_lead", nameless.id).length, 1, "a job post with no company name is skipped");
  const send = by("send_email", acme.id)[0];
  assert.equal(send.status, "pending", "Semi-auto waits for approval");
  assert.deepEqual(send.escalations, []);
  assert.equal(email.sent.length, 0, "nothing sent before approval");
  assert.ok(notify.all.some((n) => n.type === "agent_needs_approval"), "the person is told");

  // The person approves; the next tick sends it
  await decideAction({ actionId: send.id, userId: user.id, decision: "approve" });
  await advanceSalesRun(run.id, agentDeps(email, notify));
  assert.equal(email.sent.length, 1);
  assert.equal(email.sent[0].to, "hr@acme.test");
  assert.equal(email.sent[0].subject, "Help with your React Developer hiring");

  // Sending starts the lead's thread and the follow-up timer
  const lead = await getLead(acme.id);
  assert.equal(lead.messageSent, true);
  assert.equal(lead.conversationStatus, "awaiting_reply");
  const days = (new Date(lead.nextFollowUpAt) - Date.now()) / 86400000;
  assert.ok(days > 2.9 && days < 3.1, `first follow-up in 3 days, got ${days}`);
  const [outreach] = await db.select().from(conversationMessages).where(eq(conversationMessages.leadId, acme.id));
  assert.equal(outreach.kind, "outreach");
  assert.equal(outreach.emailMessageId, email.sent[0].messageId, "Message-ID kept for matching replies");

  // A conversation is open, so the run keeps watching instead of finishing
  const after1 = await getRun(run.id);
  assert.equal(after1.status, "waiting");
  assert.equal(after1.results.conversations.open, 1);
});

test("Auto: sends on its own, but still asks when there is no email address", async (t) => {
  if (!ready) return t.skip("database not reachable");
  const campaign = await createCampaign(user.id, { name: "Auto test" });
  const acme = await createCompanyLead(user.id, campaign.id, { company: "Orbit Labs" });
  const noEmail = await createCompanyLead(user.id, campaign.id, { company: "No Email Ltd" });
  const run = await createRun(user.id, campaign.id, { mode: "autopilot" });
  const email = fakeEmail();

  await tickUntilIdle(advanceSalesRun, run.id, agentDeps(email, fakeNotify()));

  assert.equal(email.sent.length, 1, "Orbit Labs emailed without asking");
  assert.equal(email.sent[0].to, "hr@orbitlabs.test");
  const [ask] = await db.select().from(agentActions).where(and(eq(agentActions.agentRunId, run.id), eq(agentActions.leadId, noEmail.id), eq(agentActions.action, "send_email")));
  assert.equal(ask.status, "pending", "no address: a person decides, even in Auto");
  assert.deepEqual(ask.escalations, ["no_recipient"]);
  assert.equal((await getLead(acme.id)).conversationStatus, "awaiting_reply");
});

test("Auto respects the daily email limit: the rest wait for tomorrow", async (t) => {
  if (!ready) return t.skip("database not reachable");
  const campaign = await createCampaign(user.id, { name: "Cap test" });
  for (const company of ["Beta Co", "Gamma Co", "Kappa Co"]) await createCompanyLead(user.id, campaign.id, { company });
  const run = await createRun(user.id, campaign.id, { mode: "autopilot", config: { dailyEmailCap: 2 } });
  const email = fakeEmail();

  await tickUntilIdle(advanceSalesRun, run.id, agentDeps(email, fakeNotify()));

  assert.equal(email.sent.length, 2, "only two emails today");
  const saved = await getRun(run.id);
  assert.equal(saved.results.deferred, 1, "one is deferred to tomorrow's allowance");
});

test("A company already emailed from another campaign is never emailed again without asking", async (t) => {
  if (!ready) return t.skip("database not reachable");
  // Acme was emailed by the Semi-auto test above
  const campaign = await createCampaign(user.id, { name: "Duplicate test" });
  const again = await createCompanyLead(user.id, campaign.id, { company: "Acme" });
  const run = await createRun(user.id, campaign.id, { mode: "autopilot" });
  const email = fakeEmail();

  await tickUntilIdle(advanceSalesRun, run.id, agentDeps(email, fakeNotify()));

  assert.equal(email.sent.length, 0, "not sent automatically");
  const [ask] = await db.select().from(agentActions).where(and(eq(agentActions.agentRunId, run.id), eq(agentActions.leadId, again.id), eq(agentActions.action, "send_email")));
  assert.equal(ask.status, "pending");
  assert.ok(ask.escalations.includes("contacted_elsewhere"));
});
