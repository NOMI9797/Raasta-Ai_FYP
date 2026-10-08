import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildPostingKit } from "../../libs/hiring/posting-kit";
import { ROZEE_FLOW, minimumYears, skillList, workplaceChip } from "../../libs/poster/flow-rozee";
import { createHuman } from "../../libs/poster/human";
import { FIELD_STATE, GATE, RUN_MODE, RUN_STATUS, STEP_STATUS } from "../../libs/poster/run-model";
import { createMemoryReporter, runPosting } from "../../libs/poster/runner";
import { installMockRozee } from "./helpers/mock-rozee";

// The posting engine's runner, driven in a real Chromium against the Rozee.pk practice site (libs/poster/practice): RozeeGPT's
// wizard as it was recorded on 2026-10-08. Nothing here touches Rozee.pk. The test plays the person: it clears checks, signs in,
// and publishes the draft itself.

const DESCRIPTION = [
  "We are hiring a Test Engineer in Lahore to keep our recruitment platform reliable.",
  "",
  "Responsibilities",
  "- Write and run automated tests with Node.js",
  "- Report defects and follow them to resolution",
  "",
  "Requirements",
  "- Two years of testing experience",
].join("\n");

const JOB = {
  id: "22222222-2222-2222-2222-222222222222",
  title: "Test Engineer",
  location: "Lahore",
  locationType: "onsite",
  employmentType: "full-time",
  experienceRange: "2-4 years",
  salaryMin: 30000,
  salaryMax: 50000,
  salaryCurrency: "PKR",
  requiredSkills: ["Test Automation"],
  techStack: ["Node.js"],
};

const kitFor = (overrides = {}) => buildPostingKit({ job: { ...JOB, ...overrides }, platform: "rozee", postText: DESCRIPTION, applyUrl: "http://localhost:8085/apply/x" });

let browser;
before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});

async function until(check, { timeoutMs = 25000, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function start({ mock = {}, kit = kitFor(), mode = RUN_MODE.REHEARSAL, options = {}, timing = {}, reporter = createMemoryReporter() } = {}) {
  const context = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const site = await installMockRozee(context, mock);
  const page = await context.newPage();
  const done = runPosting({
    page, flow: ROZEE_FLOW, kit, mode, options, reporter, human: createHuman({ speed: "off" }),
    timing: { pollMs: 40, recheckMs: 40, settleMs: 0, gateWaitMs: 20000, continueWaitMs: 4000, ...timing },
  });
  const gate = (kind) => until(() => reporter.state.gate?.kind === kind, { label: `the ${kind} gate` });
  const finish = async () => {
    const result = await done;
    await context.close().catch(() => {});
    return result;
  };
  return { context, page, site, reporter, done, gate, finish, held: () => page.evaluate("window.__S"), log: () => page.evaluate("window.__log") };
}

const fieldsOf = (reporter, stepId) => reporter.state.steps.find((s) => s.id === stepId)?.fields || [];
const NEVER = (log) => log.filter((entry) => /^(PAID|PUBLISH)/.test(entry));

test("rozee flow: its rules without a browser (experience, skills, workplace, page matching)", () => {
  assert.equal(minimumYears("2-4 years"), 2);
  assert.equal(minimumYears("3+ years"), 3);
  assert.equal(minimumYears("0-1 years"), 0);
  assert.equal(minimumYears("none", 1), 1);
  assert.equal(minimumYears("", 1), 1);
  assert.deepEqual(skillList("Node.js, React,node.js , , SQL"), ["Node.js", "React", "SQL"]);
  assert.ok(workplaceChip("Onsite").test("On-Site"));
  assert.ok(workplaceChip("on-site").test("On-Site"));
  assert.ok(workplaceChip("Hybrid").test("Hybrid"));
  assert.ok(workplaceChip("remote").test("Remote"));
  assert.equal(workplaceChip(""), null);
  const at = (p) => ROZEE_FLOW.matchStep(`https://www.rozeegpt.ai${p}`)?.id || null;
  assert.equal(at("/employer/dashboard"), "dashboard");
  assert.equal(at("/employer/dashboard/postjob/jobtitle"), "jobtitle");
  assert.equal(at("/employer/dashboard/postjob/chooseskills"), "skills");
  assert.equal(at("/employer/dashboard/postjob/experience"), "experience");
  assert.equal(at("/employer/dashboard/postjob/genderpreference"), "gender");
  assert.equal(at("/employer/dashboard/postjob/manageemployees"), "manage");
  assert.equal(at("/employer/dashboard/postjob/otherrequirements"), "other");
  assert.equal(at("/employer/dashboard/postjob/cityid"), "city");
  assert.equal(at("/employer/dashboard/postjob/maximumbudget"), "budget");
  assert.equal(at("/employer/job/app/159237/description"), "draft");
  assert.equal(at("/employer/audit-log"), null);
  assert.equal(at("/employer/dashboard/postjob/unknown"), null);
  assert.equal(ROZEE_FLOW.confirmLabel, "Publish Job");
});

test("a rehearsal answers every question, swaps Rozee's AI description for the post, and stops before Publish Job", async () => {
  const run = await start();
  const result = await run.done;
  assert.equal(result.status, RUN_STATUS.REHEARSED, result.outcome?.message);
  assert.match(result.outcome.message, /Nothing was submitted/);
  assert.equal(result.outcome.verification.open, 0, JSON.stringify(run.reporter.state.steps.map((s) => s.fields.filter((f) => f.state !== "verified"))));

  const held = await run.held();
  assert.equal(held.title, "Test Engineer");
  assert.deepEqual(held.skills.map((s) => `${s.name}:${s.level}`).sort(), ["Node.js:Required", "Test Automation:Required"]);
  assert.equal(held.years, "2");
  assert.equal(held.gender, "No Preference", "the wizard asks; the engine never narrows a job by gender");
  assert.equal(held.manage, "No");
  assert.equal(held.other, "No other requirements.");
  assert.equal(held.city, "Lahore, Pakistan");
  assert.equal(held.workplace, "On-Site");
  assert.equal(held.budget, "50000");
  // the draft Rozee's AI wrote now carries the recruiter's post, and Rozee's own Responsibilities text is gone
  assert.equal(held.desc.replace(/\s+/g, " ").trim(), DESCRIPTION.replace(/\s+/g, " ").trim());
  assert.equal(held.resp.trim(), "");

  const log = await run.log();
  assert.deepEqual(NEVER(log), [], "nothing was published or bought");
  assert.ok(!log.includes("click:Publish Job") && !log.includes("click:Apply Credit"), "the publish buttons were not pressed");
  assert.ok(log.includes("click:Keep as draft"), "the publish dialog that opens by itself was answered with Keep as draft");
  assert.ok(!log.some((entry) => entry.startsWith("optimise")), "the AI title optimiser was left alone");
  assert.equal(await run.page.evaluate("window.__published"), false);
  assert.deepEqual(run.reporter.state.steps.filter((s) => s.status === STEP_STATUS.DONE).map((s) => s.id), ["dashboard", "jobtitle", "skills", "experience", "gender", "manage", "other", "city", "budget", "draft"]);
  assert.ok(run.reporter.state.steps.every((s) => s.shot), "a screenshot for every step it handled");
  await run.context.close();
});

test("in post mode the window waits for the person to publish: Publish Job, the dialog and the credit are all theirs", async () => {
  const run = await start({ mode: RUN_MODE.POST });
  await run.gate(GATE.CONFIRM);
  assert.equal(run.reporter.state.status, RUN_STATUS.AWAITING_CONFIRM);
  assert.match(run.reporter.state.gate.message, /press Publish Job yourself/);
  assert.match(run.reporter.state.gate.message, /free Featured Job credits or sells an upgrade/);
  await new Promise((resolve) => setTimeout(resolve, 600)); // time for the engine to press something, if it were going to
  assert.deepEqual(NEVER(await run.log()), []);
  assert.equal(await run.page.evaluate("window.__published"), false);

  await run.page.click("#publish-job"); // the person publishes
  await run.page.click("#d-credit"); // and chooses the free credit
  const result = await run.done;
  assert.equal(result.status, RUN_STATUS.PUBLISHED, result.outcome?.message);
  assert.equal(result.outcome.postUrl, "https://www.rozeegpt.ai/practice-co-test-engineer-159999");
  assert.match(result.outcome.message, /You chose how to publish it/);
  const log = await run.log();
  assert.equal(log.filter((entry) => entry === "PUBLISH:credit").length, 1, "published once, by the person");
  assert.ok(!log.some((entry) => entry.startsWith("PAID")), "no upgrade was bought");
  await run.context.close();
});

test("a skill Rozee does not suggest is not forced in: the run stops for the person", async () => {
  const run = await start({ kit: kitFor({ requiredSkills: ["COBOL"], techStack: [] }) });
  await run.gate(GATE.FIELD);
  assert.match(run.reporter.state.gate.message, /None of Rozee's suggestions is one of this job's skills \(COBOL\)/);
  assert.equal((await run.held()).skills.length, 0, "no unrelated skill was chosen for the job");
  // the person picks a skill themselves and presses Continue
  await run.page.click(".chip");
  await run.page.click("[role=menu] label");
  await run.page.click("#go");
  const result = await run.finish();
  assert.equal(result.status, RUN_STATUS.REHEARSED, result.outcome?.message);
});

test("a sign-in page stops the run for the person, who signs in themselves", async () => {
  const run = await start({ mock: { signedIn: false } });
  await run.gate(GATE.SIGN_IN);
  assert.match(run.reporter.state.gate.message, /never types your password/);
  assert.match(run.reporter.state.gate.message, /email and password/);
  await run.page.click("#go"); // the person signs in
  const result = await run.finish();
  assert.equal(result.status, RUN_STATUS.REHEARSED, result.outcome?.message);
});

test("a verification check is cleared by the person, and nothing is filled in behind it", async () => {
  const run = await start({ mock: { check: true } });
  await run.gate(GATE.CHECK);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(run.reporter.state.steps.filter((s) => s.status === STEP_STATUS.DONE).length, 0);
  await run.page.click("#verify");
  const result = await run.finish();
  assert.equal(result.status, RUN_STATUS.REHEARSED, result.outcome?.message);
});

test("pay in another currency is not typed into Rozee's rupee budget: the person enters it", async () => {
  const run = await start({ kit: kitFor({ salaryCurrency: "USD" }) });
  await run.gate(GATE.FIELD);
  assert.match(run.reporter.state.gate.message, /Maximum monthly budget: Rozee\.pk's budget is in rupees per month and the job lists USD/);
  assert.equal((await run.held()).budget, "", "nothing was typed");
  assert.equal(fieldsOf(run.reporter, "budget")[0].state, FIELD_STATE.UNVERIFIED);
  run.reporter.state.cancel = true;
  assert.equal((await run.finish()).status, RUN_STATUS.CANCELLED);
});

test("when Rozee's city list does not load, the city is left to the person", async () => {
  const run = await start({ mock: { noCities: true } });
  await run.gate(GATE.FIELD);
  assert.match(run.reporter.state.gate.message, /Choose Lahore from the list yourself/);
  run.reporter.state.cancel = true;
  const result = await run.finish();
  assert.equal(result.status, RUN_STATUS.CANCELLED);
  assert.match(result.outcome.message, /Nothing was posted/);
});

test("a job with no experience range still answers the experience question, and a job with no pay answers none", async () => {
  const run = await start({ kit: kitFor({ experienceRange: null, salaryMin: null, salaryMax: null }) });
  const result = await run.done;
  assert.equal(result.status, RUN_STATUS.REHEARSED, result.outcome?.message);
  const held = await run.held();
  assert.equal(held.years, "1", "the default for a job that gives no range");
  assert.equal(held.budget, "", "no pay: nothing entered");
  assert.equal(fieldsOf(run.reporter, "budget")[0].state, FIELD_STATE.SKIPPED);
  await run.context.close();
});
