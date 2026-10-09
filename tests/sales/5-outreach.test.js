// Outreach (step 5): outreach status, sending with the daily limit, the email transport.
// Combined from the section's test files; each keeps its own setup inside its describe block.
// Run: npm run test:sales:outreach   (or: npx tsx --test tests/sales/5-outreach.test.js)
import "../../libs/load-env"; // first: the database client reads DATABASE_URL when it loads
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../../libs/db";
import { outreachBoard, sendOutreachEmails } from "../../libs/sales/outreach";
import { OUTREACH_FILTERS, OUTREACH_STATUS, outreachStatus } from "../../libs/sales/outreach-status";
import { renderEmail, sendSalesEmail } from "../../libs/sales/send/email";
import { agentActions, agentRuns, conversationMessages, messages } from "../../libs/schema";
import { closeDatabase, createCampaign, createCompanyLead, createRun, createUser, databaseReady, fakeEmail, getLead, removeUser } from "./helpers/fixtures";

// ─── Outreach status (was outreach.test.js) ───
describe("Outreach status", () => {
  const email = (over = {}) => ({ content: "Hi", channel: "email", recipient: "hr@acme.test", status: "draft", ...over });

  test("before sending: not written, needs an address, draft, ready, failed", () => {
    assert.equal(outreachStatus({ lead: {}, message: null }), OUTREACH_STATUS.NOT_WRITTEN);
    assert.equal(outreachStatus({ lead: {}, message: email({ recipient: null }) }), OUTREACH_STATUS.NEEDS_ADDRESS);
    assert.equal(outreachStatus({ lead: {}, message: email({ recipient: "not-an-email" }) }), OUTREACH_STATUS.NEEDS_ADDRESS);
    assert.equal(outreachStatus({ lead: {}, message: email() }), OUTREACH_STATUS.NOT_APPROVED);
    assert.equal(outreachStatus({ lead: {}, message: email({ status: "approved" }) }), OUTREACH_STATUS.READY);
    assert.equal(outreachStatus({ lead: { messageError: "SMTP down" }, message: email({ status: "approved" }) }), OUTREACH_STATUS.FAILED);
  });

  test("after sending, the conversation decides the status", () => {
    const sent = (conversationStatus) => outreachStatus({ lead: { messageSent: true, conversationStatus }, message: email({ status: "sent" }) });
    assert.equal(sent("awaiting_reply"), OUTREACH_STATUS.WAITING);
    assert.equal(sent(null), OUTREACH_STATUS.WAITING);
    assert.equal(sent("replied"), OUTREACH_STATUS.REPLIED);
    assert.equal(sent("in_conversation"), OUTREACH_STATUS.REPLIED);
    assert.equal(sent("meeting_proposed"), OUTREACH_STATUS.REPLIED);
    assert.equal(sent("meeting_booked"), OUTREACH_STATUS.MEETING);
    for (const s of ["not_interested", "unsubscribed", "no_response"]) assert.equal(sent(s), OUTREACH_STATUS.CLOSED, s);
  });

  test("every status belongs to exactly one filter (besides All)", () => {
    for (const status of Object.values(OUTREACH_STATUS)) {
      const homes = OUTREACH_FILTERS.filter((f) => f.statuses?.includes(status));
      assert.equal(homes.length, 1, status);
    }
  });
});

// ─── Sending (database) (was outreach.integration.test.js) ───
// Integration: the Outreach step for companies against the real database. Sending by hand shares
// the daily limit, starts the thread and follow-up timer, and withdraws the agent's request for the
// same email. Email is a fake; nothing is sent.
describe("Sending (database)", () => {
  let ready = false;
  let user;
  before(async () => {
    ready = await databaseReady();
    if (ready) user = await createUser();
  });
  after(async () => {
    if (user) await removeUser(user.id);
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
});

// ─── Email transport and test mode (was email.test.js) ───
describe("Email transport and test mode", () => {
  const fakeTransport = () => {
    const sent = [];
    return { sent, sendMail: async (mail) => (sent.push(mail), { messageId: "<fake@test>" }) };
  };

  beforeEach(() => {
    delete process.env.SALES_EMAIL_TEST_RECIPIENT;
    process.env.SENDER_EMAIL = "sender@example.com";
  });

  test("sends to the real recipient when no test address is set", async () => {
    const transport = fakeTransport();
    const out = await sendSalesEmail({ to: "hr@acme.pk", subject: "Hello", body: "Hi team,\n\nLine two", senderName: "Nouman Ahmed" }, { transport });
    assert.equal(out.to, "hr@acme.pk");
    assert.equal(out.redirected, false);
    assert.equal(transport.sent[0].to, "hr@acme.pk");
    assert.equal(transport.sent[0].subject, "Hello");
    assert.equal(transport.sent[0].from, '"Nouman Ahmed" <sender@example.com>');
  });

  test("redirects to the test address, marks the subject and names the intended recipient", async () => {
    process.env.SALES_EMAIL_TEST_RECIPIENT = "me@test.dev";
    const transport = fakeTransport();
    const out = await sendSalesEmail({ to: "hr@acme.pk", subject: "Hello", body: "Hi" }, { transport });
    assert.deepEqual([out.to, out.intendedTo, out.redirected], ["me@test.dev", "hr@acme.pk", true]);
    assert.equal(transport.sent[0].to, "me@test.dev");
    assert.equal(transport.sent[0].subject, "[TEST] Hello");
    assert.match(transport.sent[0].text, /would have gone to hr@acme\.pk/);
  });

  test("refuses invalid addresses and empty bodies", async () => {
    const transport = fakeTransport();
    await assert.rejects(sendSalesEmail({ to: "not-an-email", subject: "x", body: "x" }, { transport }), /valid email/);
    await assert.rejects(sendSalesEmail({ to: "a@b.co", subject: "x", body: "  " }, { transport }), /empty/);
    assert.equal(transport.sent.length, 0);
  });

  test("renderEmail escapes HTML and keeps paragraphs", () => {
    const { html, text } = renderEmail({ body: "Hi <b>team</b>\n\nSecond" });
    assert.match(html, /Hi &lt;b&gt;team&lt;\/b&gt;/);
    assert.equal((html.match(/<p /g) || []).length, 2);
    assert.equal(text, "Hi <b>team</b>\n\nSecond");
  });
});

// One database connection for the whole file: closed after every section has run
after(async () => {
  await closeDatabase();
});
