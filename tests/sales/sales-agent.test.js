// Sales agent: the planner, lead scoring and whole agent runs.
// Combined from the section's test files; each keeps its own setup inside its describe block.
// Run: npm run test:sales:sales-agent   (or: npx tsx --test tests/sales/sales-agent.test.js)
import "../../libs/load-env"; // first: the database client reads DATABASE_URL when it loads
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { decideAction } from "../../libs/agent/actions";
import { setLlmClient } from "../../libs/ai/llm";
import { db } from "../../libs/db";
import { acceptanceCheckDue, buildSalesPlan, isCampaignFinished, keyFor, LEAD_STAGE } from "../../libs/sales/agent/plan";
import { decideSales, ROUTE, SALES_ACTION, SALES_ESCALATION } from "../../libs/sales/agent/policy";
import { advanceSalesRun } from "../../libs/sales/agent/sales-agent";
import { normaliseScore, scoreLead, scorePrompt } from "../../libs/sales/agent/scoring";
import { defaultChannel, pickRecipient } from "../../libs/sales/contact-route";
import { agentActions, agentRuns, conversationMessages, leads, messages } from "../../libs/schema";
import { closeDatabase, createCampaign, createCompanyLead, createRun, createUser, databaseReady, fakeEmail, fakeNotify, getLead, getRun, removeUser, tickUntilIdle } from "./helpers/fixtures";

// ─── Planner and policy (was agent-plan.test.js) ───
describe("Planner and policy", () => {
  const company = (id, extra = {}) => ({ id, source: "indeed", status: "completed", company: `Company ${id}`, sourceData: {}, ...extra });
  const researched = (id, score, extra = {}) =>
    company(id, { sourceData: { research: { status: "done", emails: [`hr@${id}.pk`] }, ...(score != null ? { fit: { score, reason: "x" } } : {}) }, ...extra });
  const email = (status = "draft", recipient = "hr@acme.pk") => ({ status, channel: "email", recipient, content: "Hi" });

  const state = (leads, messages = {}, extra = {}) => ({
    leads,
    messages: new Map(Object.entries(messages)),
    actions: new Map(),
    allowance: { email: 10, invite: 10, linkedinMessage: 10 },
    ...extra,
  });

  test("policy: sending is asked about in Semi-auto and automatic in Auto; escalations are always asked", () => {
    assert.equal(decideSales(SALES_ACTION.SEND_EMAIL, "assisted"), ROUTE.ASK);
    assert.equal(decideSales(SALES_ACTION.SEND_EMAIL, "autopilot"), ROUTE.AUTO);
    assert.equal(decideSales(SALES_ACTION.SEND_EMAIL, "semi_auto"), ROUTE.ASK);
    assert.equal(decideSales(SALES_ACTION.RESEARCH, "assisted"), ROUTE.AUTO);
    assert.equal(decideSales(SALES_ACTION.SEND_EMAIL, "autopilot", { escalations: ["no_recipient"] }), ROUTE.ASK);
  });

  test("leads move research → score → skip or write", () => {
    const plan = buildSalesPlan(state([company("a"), researched("b"), researched("c", 20), researched("d", 80)]), { mode: "autopilot" });
    assert.deepEqual(plan.research, ["a"]);
    assert.deepEqual(plan.score, ["b"]);
    assert.deepEqual(plan.skip.map((s) => s.leadId), ["c"]);
    assert.deepEqual(plan.write, ["d"]);
  });

  test("Semi-auto asks before sending an email; Auto sends it", () => {
    const s = state([researched("a", 80)], { a: email() });
    assert.equal(buildSalesPlan(s, { mode: "assisted" }).sends[0].route, ROUTE.ASK);
    const auto = buildSalesPlan(s, { mode: "autopilot" });
    assert.deepEqual([auto.sends[0].action, auto.sends[0].route], [SALES_ACTION.SEND_EMAIL, ROUTE.AUTO]);
  });

  test("a message approved on the Messages step is not asked about again", () => {
    const plan = buildSalesPlan(state([researched("a", 80)], { a: email("approved") }), { mode: "assisted" });
    assert.equal(plan.sends[0].route, ROUTE.AUTO);
    assert.equal(plan.sends[0].approvedByMessage, true);
  });

  test("escalations: no address, borderline fit, contacted in another campaign", () => {
    const s = state(
      [researched("a", 80), researched("b", 55), researched("c", 90)],
      { a: email("approved", ""), b: email(), c: email() }, // a: approved with the address removed by hand
      { contactedElsewhere: new Set(["c"]) }
    );
    const plan = buildSalesPlan(s, { mode: "autopilot" });
    const by = Object.fromEntries(plan.sends.map((x) => [x.leadId, x]));
    assert.deepEqual(by.a.escalations, [SALES_ESCALATION.NO_RECIPIENT]);
    assert.deepEqual(by.b.escalations, [SALES_ESCALATION.BORDERLINE_FIT]);
    assert.deepEqual(by.c.escalations, [SALES_ESCALATION.CONTACTED_ELSEWHERE]);
    assert.ok(plan.sends.every((x) => x.route === ROUTE.ASK));
  });

  test("an email to an address from an unconfirmed website is asked about, even in Auto (found by the end-to-end run)", () => {
    // Research picked alphabet.com (a German leasing firm) for "Alphabet Global", a Lahore software house
    const unconfirmed = company("a", { sourceData: { research: { status: "done", website: "https://www.alphabet.com", websiteConfirmed: false }, fit: { score: 90, reason: "x" } } });
    const confirmed = company("b", { sourceData: { research: { status: "done", website: "https://terasols.com", websiteConfirmed: true }, fit: { score: 90, reason: "x" } } });
    const older = company("c", { sourceData: { research: { status: "done" }, fit: { score: 90, reason: "x" } } }); // researched before the check existed
    const plan = buildSalesPlan(state([unconfirmed, confirmed, older], { a: email(), b: email(), c: email() }), { mode: "autopilot" });
    const by = Object.fromEntries(plan.sends.map((x) => [x.leadId, x]));
    assert.deepEqual(by.a.escalations, [SALES_ESCALATION.WEBSITE_UNCONFIRMED]);
    assert.equal(by.a.route, ROUTE.ASK);
    assert.deepEqual([by.b.route, by.c.route], [ROUTE.AUTO, ROUTE.AUTO]);
  });

  test("Auto respects the daily email cap and defers the rest", () => {
    const leads = ["a", "b", "c"].map((id) => researched(id, 90));
    const plan = buildSalesPlan(state(leads, { a: email(), b: email(), c: email() }, { allowance: { email: 2 } }), { mode: "autopilot" });
    assert.equal(plan.sends.length, 2);
    assert.deepEqual(plan.deferred.map((d) => d.leadId), ["c"]);
  });

  test("an existing action is not proposed twice, and a rejection stops the lead", () => {
    const leads = [researched("a", 90), researched("b", 90)];
    const actions = new Map([
      [keyFor(SALES_ACTION.SEND_EMAIL, "a"), { status: "pending" }],
      [keyFor(SALES_ACTION.SEND_EMAIL, "b"), { status: "rejected" }],
    ]);
    const plan = buildSalesPlan(state(leads, { a: email(), b: email() }, { actions }), { mode: "assisted" });
    assert.equal(plan.sends.length, 0);
    assert.equal(plan.stages.a, LEAD_STAGE.AWAITING_APPROVAL);
    assert.equal(plan.stages.b, LEAD_STAGE.STOPPED);
  });

  test("LinkedIn: invite first, wait for acceptance, then message; blocked without an account", () => {
    const person = (id, extra) => ({ id, source: "linkedin", status: "completed", url: `https://linkedin.com/in/${id}`, sourceData: { fit: { score: 90 } }, ...extra });
    const li = { status: "draft", channel: "linkedin", content: "Hi" };
    const leads = [person("a"), person("b", { inviteSent: true, inviteStatus: "sent" }), person("c", { inviteSent: true, inviteStatus: "accepted" })];
    const plan = buildSalesPlan(state(leads, { a: li, b: li, c: li }, { linkedinReady: true }), { mode: "autopilot" });
    assert.deepEqual(plan.sends.map((s) => [s.leadId, s.action]), [["a", SALES_ACTION.SEND_INVITE], ["c", SALES_ACTION.SEND_LINKEDIN_MESSAGE]]);
    assert.equal(plan.stages.b, LEAD_STAGE.AWAITING_ACCEPTANCE);
    assert.equal(acceptanceCheckDue(plan, null), true);
    assert.equal(acceptanceCheckDue(plan, new Date(Date.now() - 3600 * 1000)), false);

    const noAccount = buildSalesPlan(state([person("a")], { a: li }), { mode: "autopilot" });
    assert.equal(noAccount.stages.a, LEAD_STAGE.BLOCKED);
  });

  test("a company with no email is reached on LinkedIn: it waits for an account instead of an email with no address", () => {
    // The end-to-end run (9 Oct 2026): ~60% of Rozee.pk companies had no email but a decision-maker on LinkedIn
    const li = { status: "draft", channel: "linkedin", recipient: "https://linkedin.com/in/ali", content: "Hi Ali" };
    const lead = researched("a", 90, { company: "Nexsoll" });
    const waiting = buildSalesPlan(state([lead], { a: li }), { mode: "autopilot" });
    assert.equal(waiting.stages.a, LEAD_STAGE.BLOCKED);
    assert.match(waiting.blocked[0].reason, /No email found: choose a LinkedIn account/);
    assert.equal(waiting.sends.length, 0, "nothing is sent, and no email without an address is asked about");
    const withAccount = buildSalesPlan(state([lead], { a: li }, { linkedinReady: true }), { mode: "autopilot" });
    assert.deepEqual(withAccount.sends.map((x) => x.action), [SALES_ACTION.SEND_INVITE]);
  });

  test("an unaddressed email draft is rewritten once research finds a contact; the withdrawn request doesn't block the new one", () => {
    const noAddress = email("draft", "");
    const linkedinOnly = researched("a", 90, { sourceData: { research: { status: "done", emails: [], decisionMakers: [{ name: "Ali", linkedinUrl: "https://linkedin.com/in/ali" }] }, fit: { score: 90 } } });
    const nobody = researched("b", 90, { sourceData: { research: { status: "partial", emails: [], decisionMakers: [] }, fit: { score: 90 } } });
    const edited = researched("c", 90, { sourceData: { research: { status: "done", emails: ["hr@c.pk"] }, fit: { score: 90 } } });
    const plan = buildSalesPlan(state([linkedinOnly, nobody, edited], { a: noAddress, b: noAddress, c: email("approved", "") }), { mode: "assisted" });
    assert.deepEqual(plan.rewrite, ["a"], "only a draft with no address, for a company that can now be reached");
    assert.deepEqual(plan.write, ["a"]);
    // b has no contact at all: its draft is withdrawn and nothing is asked about
    assert.deepEqual([plan.needsContact, plan.dropDrafts, plan.stages.b], [["b"], ["b"], LEAD_STAGE.NEEDS_CONTACT]);
    assert.deepEqual(plan.sends.map((x) => [x.leadId, x.escalations]), [["c", [SALES_ESCALATION.NO_RECIPIENT]]]);

    // Rewritten as an email with an address: the old, withdrawn send request doesn't count as done
    const rewritten = researched("d", 90, { sourceData: { research: { status: "done", emails: ["hr@d.pk"] }, fit: { score: 90 } } });
    const s = state([rewritten], { d: email("draft", "hr@d.pk") });
    s.actions.set(keyFor(SALES_ACTION.SEND_EMAIL, "d"), { status: "superseded" });
    const again = buildSalesPlan(s, { mode: "assisted" });
    assert.deepEqual(again.sends.map((x) => [x.leadId, x.action, x.route]), [["d", SALES_ACTION.SEND_EMAIL, ROUTE.ASK]]);
  });

  test("after research companies are sorted: email, LinkedIn, or no contact (nothing written)", () => {
    const withEmail = researched("a", 90);
    const linkedinOnly = company("b", { sourceData: { research: { status: "done", emails: [], decisionMakers: [{ name: "Ali", linkedinUrl: "https://linkedin.com/in/ali" }] }, fit: { score: 90 } } });
    const nothing = company("c", { sourceData: { research: { status: "partial", website: "https://c.pk", emails: [], phones: ["+924235000000"], decisionMakers: [] }, fit: { score: 90 } } });
    const plan = buildSalesPlan(state([withEmail, linkedinOnly, nothing]), { mode: "autopilot" });
    assert.deepEqual(plan.write, ["a", "b"], "an email for a, a LinkedIn message for b");
    assert.deepEqual(plan.needsContact, ["c"]);
    assert.equal(plan.stages.c, LEAD_STAGE.NEEDS_CONTACT);
    assert.deepEqual(plan.dropDrafts, [], "c never had a draft");
    assert.equal(isCampaignFinished(buildSalesPlan(state([nothing]), { mode: "autopilot" })), true, "a company waiting for a contact doesn't keep the agent running");
  });

  test("a send request for the other channel is withdrawn when the message moves (Prima Systems on Approvals)", () => {
    const lead = company("p", { sourceData: { research: { status: "done", emails: [], decisionMakers: [{ name: "Shakil", linkedinUrl: "https://linkedin.com/in/shakil" }] }, fit: { score: 90 } } });
    const s = state([lead], { p: { status: "draft", channel: "linkedin", recipient: "https://linkedin.com/in/shakil", content: "Hi" } });
    s.actions.set(keyFor(SALES_ACTION.SEND_EMAIL, "p"), { id: "old-email", status: "pending" });
    const plan = buildSalesPlan(s, { mode: "assisted" });
    assert.deepEqual(plan.staleActions, ["old-email"]);
    assert.equal(plan.stages.p, LEAD_STAGE.BLOCKED, "the LinkedIn message waits for an account");

    // The same channel is not touched
    const same = state([researched("q", 90)], { q: email() });
    same.actions.set(keyFor(SALES_ACTION.SEND_EMAIL, "q"), { id: "keep", status: "pending" });
    assert.deepEqual(buildSalesPlan(same, { mode: "assisted" }).staleActions, []);
  });

  test("the campaign is finished when every lead is sent, skipped or stopped", () => {
    const done = buildSalesPlan(state([researched("a", 10), researched("b", 90, { messageSent: true })]), { mode: "autopilot" });
    assert.equal(isCampaignFinished(done), true);
    const open = buildSalesPlan(state([researched("a", 90)]), { mode: "autopilot" });
    assert.equal(isCampaignFinished(open), false);
  });

  test("job posts without a company name are skipped; failed research blocks the lead until someone researches it", () => {
    const nameless = company("a", { company: null, name: null });
    const blocked = company("b", { company: "Acme" });
    const plan = buildSalesPlan(state([nameless, blocked], {}, { researchBlocked: new Map([["b", "Website could not be read"]]) }), { mode: "autopilot" });
    assert.deepEqual(plan.skip, [{ leadId: "a", reason: "The job post has no company name" }]);
    assert.equal(plan.stages.b, LEAD_STAGE.BLOCKED);
    assert.deepEqual(plan.research, []);

    const researchedLater = buildSalesPlan(state([researched("b", null, { company: "Acme" })], {}, { researchBlocked: new Map([["b", "x"]]) }), { mode: "autopilot" });
    assert.deepEqual(researchedLater.score, ["b"]);
  });
});

// ─── Lead scoring (was agent-scoring.test.js) ───
describe("Lead scoring", () => {
  after(() => setLlmClient(null));

  const fakeLlm = (content) => ({ chat: { completions: { create: async () => ({ choices: [{ message: { content } }] }) } } });

  test("the prompt for a company carries its roles, size, website text and the offer", () => {
    const { user } = scorePrompt({
      lead: {
        source: "indeed",
        company: "Acme",
        sourceData: {
          jobs: [{ title: "React Developer" }, { title: "QA" }],
          company: { employees: "51 to 200", industry: "Software" },
          research: { description: "Fintech apps", emails: ["hr@acme.pk"] },
        },
      },
      campaign: { icpConfig: { serviceType: "Staff augmentation" } },
    });
    assert.match(user, /What we sell: Staff augmentation/);
    assert.match(user, /Open roles: React Developer; QA/);
    assert.match(user, /Size: 51 to 200 staff/);
    assert.match(user, /Contact found: an email address/);
  });

  test("scores are clamped to 0-100 and a missing score is an error", () => {
    assert.deepEqual(normaliseScore({ score: 140, reason: "great" }), { score: 100, reason: "great" });
    assert.equal(normaliseScore({ score: "72.4" }).score, 72);
    assert.throws(() => normaliseScore({ reason: "x" }), /score/);
  });

  test("scoreLead reads the model's JSON", async () => {
    setLlmClient(fakeLlm('{"score": 81, "reason": "Hiring three React developers; we place React engineers."}'));
    const fit = await scoreLead({ lead: { source: "indeed", company: "Acme", sourceData: {} }, campaign: {} });
    assert.equal(fit.score, 81);
    assert.match(fit.reason, /React/);
    assert.ok(fit.scoredAt);
  });
});

// ─── Agent runs end to end (database) (was agent-flow.integration.test.js) ───
// Integration: the sales agent works a campaign end to end against the real database:
// research → score → skip poor fits → write → ask (Semi-auto) or send (Auto) → thread + follow-up timer.
// Research, scoring, writing and email are fakes, so nothing leaves the machine.
// Repeats the manual runs "Agent Test - Indeed Semi-auto" and the Auto run on "Indeed Test Campaign".
describe("Agent runs end to end (database)", () => {
  let ready = false;
  let user;
  before(async () => {
    ready = await databaseReady();
    if (ready) user = await createUser();
  });
  after(async () => {
    if (user) await removeUser(user.id);
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
});

// One database connection for the whole file: closed after every section has run
after(async () => {
  await closeDatabase();
});
