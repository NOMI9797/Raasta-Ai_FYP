import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildPostingKit } from "../../libs/hiring/posting-kit";
import { INDEED_FLOW } from "../../libs/poster/flow-indeed";
import { createHuman } from "../../libs/poster/human";
import { FIELD_STATE, GATE, RUN_MODE, RUN_STATUS, STEP_STATUS } from "../../libs/poster/run-model";
import { createMemoryReporter, runPosting } from "../../libs/poster/runner";
import { installMockIndeed } from "./helpers/mock-indeed";

// The posting engine's runner, driven in a real Chromium against a stand-in for Indeed's employer area
// (the practice site, libs/poster/practice). Nothing here touches Indeed. The test plays the person: it clears checks, signs in, and
// presses the final Confirm itself.

const DESCRIPTION = [
  "We are hiring a Full Stack Developer in Islamabad to build and run our recruitment platform.",
  "",
  "About the role",
  "- Build features with Node.js and React",
  "- Review code and keep the system reliable",
  "",
  "About you",
  "- Three years of experience with JavaScript",
  "- You write clear, tested code",
].join("\n");

const JOB = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "Full Stack Developer (Node.js / React)",
  location: "Islamabad",
  locationType: "onsite",
  employmentType: "full-time",
  salaryMin: 150000,
  salaryMax: 250000,
  salaryCurrency: "PKR",
  requiredSkills: ["JavaScript"],
  techStack: ["Node.js"],
};

const kitFor = (overrides = {}) => buildPostingKit({ job: { ...JOB, ...overrides }, platform: "indeed", postText: DESCRIPTION, applyUrl: "http://localhost:8085/apply/x" });

let browser;
before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});

async function until(check, { timeoutMs = 20000, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

// Starts a run and returns what a test needs to play the person alongside it
async function start({ mock = {}, kit = kitFor(), mode = RUN_MODE.REHEARSAL, options = {}, speed = "off", timing = {}, reporter = createMemoryReporter() } = {}) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const site = await installMockIndeed(context, mock);
  const page = await context.newPage();
  const done = runPosting({
    page, flow: INDEED_FLOW, kit, mode, options, reporter, human: createHuman({ speed }),
    timing: { pollMs: 40, recheckMs: 40, settleMs: 0, gateWaitMs: 20000, continueWaitMs: 3000, ...timing },
  });
  const gate = (kind) => until(() => reporter.state.gate?.kind === kind, { label: `the ${kind} gate` });
  const finish = async () => {
    const result = await done;
    await context.close().catch(() => {});
    return result;
  };
  return { context, page, site, reporter, done, gate, finish, mockState: () => page.evaluate("window.__S") };
}

const fieldsOf = (reporter, stepId) => reporter.state.steps.find((s) => s.id === stepId)?.fields || [];

test("a rehearsal fills every step, reads it back from the review page, and stops before Confirm", async () => {
  const run = await start();
  const result = await run.done; // the window stays open so the test can look at what the form holds
  assert.equal(result.status, RUN_STATUS.REHEARSED, result.outcome?.message);
  assert.match(result.outcome.message, /Nothing was submitted/);
  assert.equal(result.outcome.verification.open, 0);
  assert.ok(result.outcome.verification.verified >= 9, `verified ${result.outcome.verification.verified}`);

  // what the stand-in ended up holding is what the job says (the title cleaned the way Indeed asks)
  const held = await run.page.evaluate("window.__S");
  assert.equal(held.title, "Full Stack Developer");
  assert.match(held.loc, /^Islamabad/);
  assert.deepEqual(held.types, ["full-time"]);
  assert.equal(held.timeline, "1 to 2 weeks");
  assert.equal(held.hires, "1");
  assert.equal(held.min, "150,000");
  assert.equal(held.max, "250,000");
  assert.equal(held.period, "per month");
  assert.equal(held.desc.replace(/\s+/g, " ").trim(), DESCRIPTION.replace(/\s+/g, " ").trim());

  // it never pressed the final button, nor anything about plans
  assert.equal(await run.page.evaluate("window.__confirms || 0"), 0);
  assert.match(run.page.url(), /\/review-job$/);
  const timeline = run.reporter.state.steps;
  assert.deepEqual(timeline.filter((s) => s.status === STEP_STATUS.DONE).map((s) => s.id), ["start", "basics", "hiring", "pay", "description", "review"]);
  assert.ok(timeline.every((s) => s.shot), "a screenshot for every step it handled");
  const review = fieldsOf(run.reporter, "review");
  assert.ok(review.filter((f) => f.key !== "applicationMethod").every((f) => f.state === FIELD_STATE.VERIFIED), JSON.stringify(review));
  const method = review.find((f) => f.key === "applicationMethod");
  assert.equal(method.state, FIELD_STATE.SKIPPED);
  assert.match(method.note, /Email/);
  await run.context.close();
});

test("in post mode the window waits for the person to press Confirm, then declines the paid plan and records the job", async () => {
  const run = await start({ mode: RUN_MODE.POST });
  await run.gate(GATE.CONFIRM);
  assert.equal(run.reporter.state.status, RUN_STATUS.AWAITING_CONFIRM);
  assert.match(run.reporter.state.gate.message, /press Confirm yourself/);
  await new Promise((resolve) => setTimeout(resolve, 600)); // time for the engine to press it, if it were going to
  assert.equal(await run.page.evaluate("window.__confirms || 0"), 0, "the engine never presses Confirm");

  await run.page.click('[data-testid="footer-continue-btn"]'); // the person confirms
  const result = await run.done;
  assert.equal(result.status, RUN_STATUS.PUBLISHED, result.outcome?.message);
  assert.equal(result.outcome.postUrl, "https://employers.indeed.com/jobs/view?jobId=abc123", "only the job's own identifier is kept");
  assert.equal(result.outcome.indeedStatus, "Pending");
  assert.match(result.outcome.message, /still reviewing/);
  const clicks = await run.page.evaluate("window.__log");
  assert.ok(!clicks.some((entry) => entry.startsWith("PAID")), "no paid plan was chosen");
  assert.ok(clicks.includes("click:No thanks") && clicks.includes("click:No thanks (confirm)"));
  assert.equal(run.reporter.state.gate, null);
  await run.context.close();
});

test("with sponsorship left to the person, the engine does not answer the paid plans at all", async () => {
  const run = await start({ mode: RUN_MODE.POST, options: { declineSponsorship: false } });
  await run.gate(GATE.CONFIRM);
  await run.page.click('[data-testid="footer-continue-btn"]');
  await run.gate(GATE.SPONSOR);
  assert.match(run.reporter.state.gate.message, /never picks a plan/);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.deepEqual(await run.page.evaluate("window.__log.filter((e) => /No thanks|PAID/.test(e))"), []);
  run.reporter.state.cancel = true;
  const result = await run.finish();
  assert.equal(result.status, RUN_STATUS.CANCELLED);
  assert.match(result.outcome.message, /already pressed Confirm/, "after Confirm the message says the job may exist");
});

test("a verification check stops the run for the person, and it carries on once the check is cleared", async () => {
  const run = await start({ mock: { check: true } });
  await run.gate(GATE.CHECK);
  assert.equal(run.reporter.state.status, RUN_STATUS.NEEDS_YOU);
  assert.match(run.reporter.state.gate.message, /never clicks it/);
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(run.reporter.state.steps.filter((s) => s.status === STEP_STATUS.DONE).length, 0, "nothing is filled in behind a check");
  run.site.clearCheck();
  const result = await run.finish();
  assert.equal(result.status, RUN_STATUS.REHEARSED, result.outcome?.message);
  assert.equal(run.reporter.state.gate, null);
});

test("a sign-in page stops the run for the person, who signs in themselves", async () => {
  const run = await start({ mock: { signedIn: false } });
  await run.gate(GATE.SIGN_IN);
  assert.match(run.reporter.state.gate.message, /never types your password/);
  await run.page.click("#go"); // the person signs in
  const result = await run.finish();
  assert.equal(result.status, RUN_STATUS.REHEARSED, result.outcome?.message);
});

test("when Indeed will not move on, the run shows what Indeed said and waits for the person", async () => {
  const run = await start({ mock: { titlePrompt: true } });
  await run.gate(GATE.FIELD);
  assert.match(run.reporter.state.gate.message, /did not move on: "Your job title may need changes/);
  assert.equal(run.reporter.state.steps.find((s) => s.id === "basics").status, STEP_STATUS.NEEDS_YOU);
  await run.page.click("#title-go"); // the person answers Indeed's question
  const result = await run.finish();
  assert.equal(result.status, RUN_STATUS.REHEARSED, result.outcome?.message);
  assert.equal(run.reporter.state.steps.find((s) => s.id === "basics").status, STEP_STATUS.DONE);
});

test("a field it cannot fill in is left to the person, and the run does not type over Indeed's own value", async () => {
  const run = await start({ kit: kitFor({ salaryCurrency: "USD" }) });
  await run.gate(GATE.FIELD);
  assert.match(run.reporter.state.gate.message, /Pay: Indeed's pay form here is in rupees and the job lists USD/);
  const pay = fieldsOf(run.reporter, "pay");
  assert.equal(pay[0].state, FIELD_STATE.UNVERIFIED);
  assert.equal((await run.mockState()).min, "33,000", "Indeed's own estimate was left alone");
  await run.page.click('[data-testid="footer-continue-btn"]'); // the person decides and moves on
  const result = await run.finish();
  assert.equal(result.status, RUN_STATUS.REHEARSED, result.outcome?.message);
  assert.ok(result.outcome.verification.open >= 1, "the unverified pay shows up in the totals");
});

test("a job with no pay does not publish Indeed's estimate unnoticed", async () => {
  const run = await start({ kit: kitFor({ salaryMin: null, salaryMax: null }) });
  await run.gate(GATE.FIELD);
  assert.match(run.reporter.state.gate.message, /Indeed filled in its own estimate/);
  run.reporter.state.cancel = true;
  assert.equal((await run.finish()).status, RUN_STATUS.CANCELLED);
});

test("going back to a step to edit it is respected: nothing is typed over the person's change", async () => {
  const run = await start({ mode: RUN_MODE.POST });
  await run.gate(GATE.CONFIRM);
  await run.page.goBack(); // the person goes back to the description
  await until(() => /Back on|back on/.test(run.reporter.state.gate?.message || ""), { label: "the back-on-a-step gate" });
  assert.match(run.reporter.state.gate.message, /You are back on "Job description"/);
  const before = (await run.mockState()).desc;
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal((await run.mockState()).desc, before);
  await run.page.click('[data-testid="footer-continue-btn"]'); // back to the review
  await until(() => run.reporter.state.gate?.kind === GATE.CONFIRM && /press Confirm yourself/.test(run.reporter.state.gate.message), { label: "the review again" });
  assert.equal(await run.page.evaluate("window.__confirms || 0"), 0);
  run.reporter.state.cancel = true;
  assert.equal((await run.finish()).status, RUN_STATUS.CANCELLED);
});

test("stopping a run that is waiting closes it as cancelled and says nothing was posted", async () => {
  const run = await start({ mock: { check: true } });
  await run.gate(GATE.CHECK);
  run.reporter.state.cancel = true;
  const result = await run.finish();
  assert.equal(result.status, RUN_STATUS.CANCELLED);
  assert.equal(result.outcome.code, "cancelled");
  assert.match(result.outcome.message, /Nothing was posted/);
});

test("closing the window ends the run as cancelled", async () => {
  const run = await start({ mock: { check: true } });
  await run.gate(GATE.CHECK);
  await run.page.close();
  const result = await run.finish();
  assert.equal(result.status, RUN_STATUS.CANCELLED);
  assert.equal(result.outcome.code, "window_closed");
});

test("nobody coming back to a waiting window ends the run instead of waiting for ever", async () => {
  const run = await start({ mock: { check: true }, timing: { gateWaitMs: 400 } });
  const result = await run.finish();
  assert.equal(result.status, RUN_STATUS.FAILED);
  assert.equal(result.outcome.code, "timed_out");
});

test("the typing looks like a person: one key at a time, with uneven gaps, and the text comes out right", async () => {
  const run = await start({ speed: "fast", kit: kitFor({ title: "Senior Data Engineer", salaryMin: null, salaryMax: null }) });
  await run.gate(GATE.FIELD); // stops at the pay step (no pay): by then the basics step has been typed
  const keys = await run.page.evaluate("window.__keys");
  assert.ok(keys.length >= "Senior Data Engineer".length, `${keys.length} key presses`);
  const gaps = keys.slice(1).map((time, i) => time - keys[i]).filter((gap) => gap < 2000);
  assert.ok(gaps.length > 10 && new Set(gaps).size > 4, "the gaps between keys are not all the same");
  assert.ok(Math.max(...gaps) > 20, "there are real pauses between keys");
  assert.equal((await run.mockState()).title, "Senior Data Engineer", "slips are corrected");
  run.reporter.state.cancel = true;
  await run.finish();
});

test("a paused employer account ends the run at once instead of waiting: nothing can be posted, and nothing is filled in", async () => {
  const run = await start({ mock: { paused: true }, timing: { gateWaitMs: 20000 } });
  const started = Date.now();
  const result = await run.finish();
  assert.equal(result.status, RUN_STATUS.FAILED);
  assert.equal(result.outcome.code, "account_paused");
  assert.match(result.outcome.message, /paused this employer account/);
  assert.match(result.outcome.message, /does not fill in that form/);
  assert.ok(Date.now() - started < 8000, "it did not wait for a person");
  assert.equal(run.reporter.state.steps.filter((s) => s.status === STEP_STATUS.DONE).length, 0);
});

test("a block page with nothing to complete is called what it is, with its Ray ID, and the run ends after a short wait", async () => {
  const run = await start({ mock: { blocked: true }, timing: { blockedWaitMs: 500, gateWaitMs: 20000 } });
  await run.gate(GATE.CHECK);
  assert.match(run.reporter.state.gate.message, /blocking this window \(Ray ID a46f2681e927712c\) and there is nothing on the page to complete/);
  assert.doesNotMatch(run.reporter.state.gate.message, /Complete it in the browser window/);
  const result = await run.finish();
  assert.equal(result.status, RUN_STATUS.FAILED);
  assert.equal(result.outcome.code, "blocked");
  assert.match(result.outcome.message, /Copy and open/);
});

test("a practice site check is cleared by its own button, the way a person clears the real one", async () => {
  const run = await start({ mock: { check: true } });
  await run.gate(GATE.CHECK);
  await run.page.click("#verify");
  const result = await run.finish();
  assert.equal(result.status, RUN_STATUS.REHEARSED, result.outcome?.message);
});
