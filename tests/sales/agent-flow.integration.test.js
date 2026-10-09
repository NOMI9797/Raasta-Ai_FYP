// Integration: the sales agent works a campaign end to end against the real database:
// research → score → skip poor fits → write → ask (Semi-auto) or send (Auto) → thread + follow-up timer.
// Research, scoring, writing and email are fakes, so nothing leaves the machine.
// Repeats the manual runs "Agent Test - Indeed Semi-auto" and the Auto run on "Indeed Test Campaign".
import "../../libs/load-env"; // first: the database client reads DATABASE_URL when it loads
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "../../libs/db";
import { agentActions, agentRuns, conversationMessages, leads, messages } from "../../libs/schema";
import { advanceSalesRun } from "../../libs/sales/agent/sales-agent";
import { decideAction } from "../../libs/agent/actions";
import { defaultChannel, pickRecipient } from "../../libs/sales/contact-route";
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

const FIT = { Acme: 82, "Orbit Labs": 80, "Low Fit Traders": 25, "No Email Ltd": 75, "LinkedIn Only Co": 78 };

/** Fakes for the agent's tools: research finds an email (except for "No Email Ltd"), scoring by name, writing an email. */
function agentDeps(email, notify) {
  return {
    tick: async () => {},
    notifyFn: notify.fn,
    emailFn: email.send,
    researchFn: async (lead) => {
      const noEmail = ["No Email Ltd", "LinkedIn Only Co"].includes(lead.company);
      const found = noEmail ? [] : [`hr@${lead.company.toLowerCase().replace(/\s+/g, "")}.test`];
      const decisionMakers = lead.company === "LinkedIn Only Co" ? [{ name: "Sara Ahmed", title: "CEO", linkedinUrl: "https://www.linkedin.com/in/sara-test" }] : [];
      const research = { status: found.length || decisionMakers.length ? "done" : "partial", website: `https://${lead.company.toLowerCase().replace(/\s+/g, "")}.test`, emails: found, phones: [], decisionMakers };
      const [updated] = await db.update(leads).set({ sourceData: { ...lead.sourceData, research } }).where(eq(leads.id, lead.id)).returning();
      return updated;
    },
    scoreFn: async ({ lead }) => ({ score: FIT[lead.company] ?? 60, reason: `Test score for ${lead.company}`, model: "fake", scoredAt: new Date().toISOString() }),
    writeFn: async ({ lead, userId }) => {
      // The real channel rule (contact-route): email, else LinkedIn, else nothing is written
      const channel = defaultChannel(lead.sourceData?.research);
      if (!channel) throw new Error("writeFn called for a company with no contact");
      const recipient = pickRecipient(lead.sourceData?.research, channel)?.address || null;
      const [message] = await db.insert(messages).values({
        userId, leadId: lead.id, campaignId: lead.campaignId, source: lead.source, channel, status: "draft",
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

test("Auto: emails a company with an address; LinkedIn-only waits for an account; no contact gets no message", async (t) => {
  if (!ready) return t.skip("database not reachable");
  const campaign = await createCampaign(user.id, { name: "Auto test" });
  const acme = await createCompanyLead(user.id, campaign.id, { company: "Orbit Labs" });
  const noEmail = await createCompanyLead(user.id, campaign.id, { company: "No Email Ltd" });
  const linkedinOnly = await createCompanyLead(user.id, campaign.id, { company: "LinkedIn Only Co" });
  const run = await createRun(user.id, campaign.id, { mode: "autopilot" });
  const email = fakeEmail();

  await tickUntilIdle(advanceSalesRun, run.id, agentDeps(email, fakeNotify()));

  assert.equal(email.sent.length, 1, "Orbit Labs emailed without asking");
  assert.equal(email.sent[0].to, "hr@orbitlabs.test");
  assert.equal((await getLead(acme.id)).conversationStatus, "awaiting_reply");

  // No email, no LinkedIn: nothing written, nothing asked
  const noEmailMessages = await db.select().from(messages).where(eq(messages.leadId, noEmail.id));
  assert.equal(noEmailMessages.length, 0, "no message for a company with no contact");
  const asks = await db.select().from(agentActions).where(and(eq(agentActions.agentRunId, run.id), eq(agentActions.leadId, noEmail.id), eq(agentActions.action, "send_email")));
  assert.equal(asks.length, 0);

  // LinkedIn only: a LinkedIn message to the decision-maker, waiting for a LinkedIn account
  const [li] = await db.select().from(messages).where(eq(messages.leadId, linkedinOnly.id));
  assert.deepEqual([li.channel, li.recipient], ["linkedin", "https://www.linkedin.com/in/sara-test"]);
  const saved = await getRun(run.id);
  assert.equal(saved.results.counts.needs_contact, 1);
  assert.match(saved.results.blocked, /choose a LinkedIn account/);
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

test("LinkedIn people: read with the connected account, then scored and written to; without an account they wait", async (t) => {
  if (!ready) return t.skip("database not reachable");
  const campaign = await createCampaign(user.id, { name: "LinkedIn people test", sources: ["linkedin"] });
  const [person] = await db.insert(leads).values({ userId: user.id, campaignId: campaign.id, source: "linkedin", url: "https://www.linkedin.com/in/test-person-x/?isSelfProfile=true", status: "pending", sourceData: {} }).returning();
  const email = fakeEmail();
  const read = [];
  const deps = {
    ...agentDeps(email, fakeNotify()),
    linkedin: { getLinkedInAccount: async () => ({ id: "acc" }), linkedInAllowance: async () => ({ invites: 5, messages: 5 }), sendInvites: async () => ({ sent: 0 }), checkAcceptances: async () => null },
    profileFn: async (account, people) => {
      read.push(...people.map((p) => p.id));
      for (const p of people) await db.update(leads).set({ name: "Test Person", title: "CTO at Acme", status: "completed", sourceData: { profile: { name: "Test Person", posts: 2 } } }).where(eq(leads.id, p.id));
      return people.map((p) => ({ leadId: p.id, ok: true, posts: 2, name: "Test Person", headline: "CTO at Acme" }));
    },
    scoreFn: async () => ({ score: 85, reason: "CTO at a growing company", model: "fake", scoredAt: new Date().toISOString() }),
    writeFn: async ({ lead, userId }) => {
      const [message] = await db.insert(messages).values({ userId, leadId: lead.id, campaignId: lead.campaignId, source: "linkedin", channel: "linkedin", status: "draft", recipient: lead.url, content: "Hi Test, saw your post.", model: "fake" }).returning();
      return { message };
    },
  };

  // Without an account: nothing is read, the agent says why
  const noAccount = await createRun(user.id, campaign.id, { mode: "assisted" });
  await tickUntilIdle(advanceSalesRun, noAccount.id, { ...deps, linkedin: { ...deps.linkedin, getLinkedInAccount: async () => null } });
  assert.equal(read.length, 0);
  const [why] = await db.select().from(agentActions).where(and(eq(agentActions.agentRunId, noAccount.id), eq(agentActions.leadId, person.id)));
  assert.match(why.summary, /choose a LinkedIn account/);
  await db.update(agentRuns).set({ status: "cancelled" }).where(eq(agentRuns.id, noAccount.id));

  // With the account: read, scored, a LinkedIn message written, and the invite asked about (Semi-auto)
  const run = await createRun(user.id, campaign.id, { mode: "assisted", config: { accountId: "acc" } });
  await tickUntilIdle(advanceSalesRun, run.id, deps);
  assert.deepEqual(read, [person.id]);
  const after = await getLead(person.id);
  assert.deepEqual([after.status, after.sourceData.fit.score], ["completed", 85]);
  const [ask] = await db.select().from(agentActions).where(and(eq(agentActions.agentRunId, run.id), eq(agentActions.leadId, person.id), eq(agentActions.action, "send_invite")));
  assert.equal(ask.status, "pending", "Semi-auto asks before the invite");
});

