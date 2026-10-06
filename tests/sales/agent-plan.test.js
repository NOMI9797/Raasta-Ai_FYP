import { test } from "node:test";
import assert from "node:assert/strict";
import { LEAD_STAGE, acceptanceCheckDue, buildSalesPlan, isCampaignFinished, keyFor } from "../../libs/sales/agent/plan";
import { ROUTE, SALES_ACTION, SALES_ESCALATION, decideSales } from "../../libs/sales/agent/policy";

const company = (id, extra = {}) => ({ id, source: "indeed", status: "completed", company: `Company ${id}`, sourceData: {}, ...extra });
const researched = (id, score, extra = {}) =>
  company(id, { sourceData: { research: { status: "done" }, ...(score != null ? { fit: { score, reason: "x" } } : {}) }, ...extra });
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
    { a: email("draft", ""), b: email(), c: email() },
    { contactedElsewhere: new Set(["c"]) }
  );
  const plan = buildSalesPlan(s, { mode: "autopilot" });
  const by = Object.fromEntries(plan.sends.map((x) => [x.leadId, x]));
  assert.deepEqual(by.a.escalations, [SALES_ESCALATION.NO_RECIPIENT]);
  assert.deepEqual(by.b.escalations, [SALES_ESCALATION.BORDERLINE_FIT]);
  assert.deepEqual(by.c.escalations, [SALES_ESCALATION.CONTACTED_ELSEWHERE]);
  assert.ok(plan.sends.every((x) => x.route === ROUTE.ASK));
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
