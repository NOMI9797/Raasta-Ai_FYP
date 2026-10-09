import { test } from "node:test";
import assert from "node:assert/strict";
import { LEAD_STAGE, acceptanceCheckDue, buildSalesPlan, isCampaignFinished, keyFor } from "../../libs/sales/agent/plan";
import { ROUTE, SALES_ACTION, SALES_ESCALATION, decideSales } from "../../libs/sales/agent/policy";

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
