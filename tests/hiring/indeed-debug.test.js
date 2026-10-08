import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { DebugRecorder, debugEnabled, debugRoot, listDebugRuns } from "../../libs/indeed-debug";
import { DIAGNOSE_BRAKE_MS, DiagnoseError, challengeMessage, checkWaitMs, diagnoseIndeed } from "../../libs/indeed-diagnose";
import { pageShowsCheck, waitForCheckToClear } from "../../libs/indeed-session-validator";

// A stand-in for the employer area, served locally: nothing here touches Indeed
const PAGES = {
  "/": `<title>Employer home</title><h1>Welcome back</h1>
    <a href="/post?token=SECRET123&draft=1">Post a job</a><a href="/jobs">Jobs</a><button data-testid="menu">Menu</button>
    <script>console.error("home exploded")</script>`,
  "/post": `<title>Post a job</title><h1>Create your job</h1>
    <label for="t">Job title</label><input id="t" name="title" value="my private draft">
    <input type="password" aria-label="Secret" value="hunter2">
    <textarea name="description" placeholder="Describe the role"></textarea>
    <button type="submit">Continue</button>`,
  "/empty": `<title>Empty</title><h1>Nothing to see</h1><p>No links here.</p>`,
  "/noform": `<title>Landing</title><a href="/empty">Post a job</a>`,
  // a verification page that a person clears after a moment: the title and the page change on their own
  "/check": `<title>Just a moment...</title><h1>Checking</h1><script>setTimeout(() => { document.title = "Post a job"; document.body.innerHTML = '<h1>Create your job</h1><input name="title"><button>Continue</button>'; }, 2500)</script>`,
  "/stuck": `<title>Just a moment...</title><h1>Checking</h1>`,
  "/guarded": `<title>Employer home</title><a href="/check">Post a job</a>`,
  "/guarded-stuck": `<title>Employer home</title><a href="/stuck">Post a job</a>`,
};

let server;
let base;
let browser;
let root;

before(async () => {
  server = http.createServer((req, res) => {
    const page = PAGES[req.url.split("?")[0]];
    res.statusCode = page ? 200 : 404;
    res.setHeader("content-type", "text/html");
    res.end(page || "not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  root = fs.mkdtempSync(path.join(os.tmpdir(), "indeed-debug-test-"));
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
});

const read = (dir, file) => fs.readFileSync(path.join(dir, file), "utf8");

async function open(url) {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page, goto: () => page.goto(url, { waitUntil: "load" }) };
}

test("debug is off unless INDEED_DEBUG=true, and files go where INDEED_DEBUG_DIR says", () => {
  assert.equal(debugEnabled({}), false);
  assert.equal(debugEnabled({ INDEED_DEBUG: "1" }), false);
  assert.equal(debugEnabled({ INDEED_DEBUG: "true" }), true);
  assert.equal(debugRoot({ INDEED_DEBUG_DIR: root }), path.resolve(root));
  assert.ok(debugRoot({}).endsWith("debug-indeed"));
});

test("a snapshot saves the screenshot and the page structure, and never the values or the query strings", async () => {
  const { context, page, goto } = await open(`${base}/post?draft=secret-draft`);
  await goto();
  const recorder = new DebugRecorder({ label: "unit", root });
  const step = await recorder.snap(page, "Post page!", { note: "a note", inline: true });
  await context.close();

  assert.equal(step.error, undefined);
  assert.equal(step.name, "Post page!");
  assert.equal(step.url, `${base}/post`, "the query string is dropped");
  assert.equal(step.title, "Post a job");
  assert.ok(step.dataUri.startsWith("data:image/jpeg;base64,"));
  assert.ok(fs.statSync(path.join(recorder.dir, step.screenshot)).size > 500);
  assert.match(step.screenshot, /^01-post-page\.jpg$/);

  const raw = read(recorder.dir, step.structure);
  const structure = JSON.parse(raw);
  assert.equal(structure.title, "Post a job");
  assert.ok(structure.headings.includes("h1: Create your job"));
  const title = structure.fields.find((f) => f.name === "title");
  assert.equal(title.label, "Job title");
  assert.equal(title.filled, true);
  assert.equal(title.hint, "#t");
  assert.equal(structure.fields.find((f) => f.type === "password").filled, undefined);
  assert.equal(structure.fields.find((f) => f.name === "description").hint, 'textarea[name="description"]');
  assert.equal(structure.buttons[0].text, "Continue");
  assert.ok(!raw.includes("my private draft") && !raw.includes("hunter2") && !raw.includes("secret-draft"), "no values, no query strings");
  assert.deepEqual(step.summary, { headings: 1, buttons: 1, links: 0, fields: 3, dialogs: 0 });
});

test("links keep their path and the names of their query parameters, not the values", async () => {
  const { context, page, goto } = await open(`${base}/`);
  await goto();
  const recorder = new DebugRecorder({ label: "links", root });
  const step = await recorder.snap(page, "home");
  await context.close();
  const raw = read(recorder.dir, step.structure);
  const structure = JSON.parse(raw);
  const post = structure.links.find((l) => l.text === "Post a job");
  assert.equal(post.href, `${base}/post?token&draft`);
  assert.ok(!raw.includes("SECRET123"));
  assert.equal(structure.buttons.find((b) => b.text === "Menu").hint, '[data-testid="menu"]');
});

test("console errors and failed requests are collected, and trace.json leaves out the inline screenshots", async () => {
  const { context, page } = await open(`${base}/`);
  const recorder = new DebugRecorder({ label: "errors", root });
  recorder.attach(page);
  await page.goto(`${base}/`, { waitUntil: "load" });
  await page.goto(`${base}/missing?x=1`, { waitUntil: "load" });
  await recorder.snap(page, "missing", { inline: true });
  recorder.note("custom", "a free-form note");
  const trace = await recorder.finish({ success: false, code: "ui_changed" });
  await context.close();

  assert.ok(recorder.console.some((c) => c.type === "error" && /home exploded/.test(c.text)));
  assert.deepEqual(recorder.failedRequests.find((r) => r.status === 404), { status: 404, method: "GET", url: `${base}/missing` });
  assert.equal(trace.steps.length, 2);
  const written = JSON.parse(read(recorder.dir, "trace.json"));
  assert.equal(written.outcome.code, "ui_changed");
  assert.ok(!JSON.stringify(written).includes("data:image"));
});

test("a snapshot of a dead page records the error instead of throwing", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await context.close();
  const recorder = new DebugRecorder({ label: "dead", root });
  const step = await recorder.snap(page, "gone");
  assert.ok(step.error);
  assert.equal(recorder.steps.length, 1);
});

test("recorded runs are listed newest first, with their outcome", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "indeed-debug-list-"));
  try {
    const env = { INDEED_DEBUG_DIR: dir };
    assert.deepEqual(await listDebugRuns({ env }), []);
    const first = new DebugRecorder({ label: "publish", env });
    await first.finish({ success: false, code: "ui_changed", error: "page changed" });
    await new Promise((resolve) => setTimeout(resolve, 15));
    const second = new DebugRecorder({ label: "diagnose", env });
    await second.finish({ outcome: "reached_post_page", message: "ok" });
    const runs = await listDebugRuns({ env });
    assert.deepEqual(runs.map((r) => [r.label, r.outcome]), [["diagnose", "reached_post_page"], ["publish", "ui_changed"]]);
    assert.equal(runs[1].message, "page changed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("only the newest 20 runs are kept", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "indeed-debug-prune-"));
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 22; i++) fs.mkdirSync(path.join(dir, `2020-01-${String(i + 1).padStart(2, "0")}T00-00-00-000Z-old`));
    const recorder = new DebugRecorder({ label: "new", root: dir });
    await recorder.finish(null);
    const kept = fs.readdirSync(dir);
    assert.equal(kept.length, 20);
    assert.ok(kept.includes(recorder.runId));
    assert.ok(!kept.includes("2020-01-01T00-00-00-000Z-old"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── The diagnostic walk, with the browser opening a local stand-in instead of Indeed ───

const QUICK = { entry: 800, render: 100, settle: 100, idle: 500, hold: 50, poll: 100, popup: 100 };

function fakeSession(startPath) {
  return async (_account, _keepOpen, { recorder }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    recorder.attach(page);
    await page.goto(`${base}${startPath}`, { waitUntil: "load" });
    await recorder.snap(page, "employer-home", { inline: true });
    return { isValid: true, reason: "ok", currentUrl: page.url(), context, page };
  };
}

test("diagnostic: follows Post a job and reports the form it reached", async () => {
  const env = { INDEED_DEBUG_DIR: root };
  const result = await diagnoseIndeed({ id: "acct-walk" }, { env, deps: { testSession: fakeSession("/"), timing: QUICK } });
  assert.equal(result.outcome, "reached_post_page");
  assert.match(result.message, /Reached the Post a job page/);
  assert.deepEqual(result.steps.map((s) => s.name), ["employer-home", "post-entry", "after-post-a-job", "post-page-settled"]);
  assert.match(result.steps[1].note, /nothing is filled in or submitted/);
  const settled = result.steps[3];
  assert.equal(settled.url, `${base}/post`);
  assert.equal(settled.summary.fields, 3);
  assert.ok(settled.dataUri);
  // the form was looked at, never touched
  const structure = JSON.parse(read(path.join(root, result.runId), settled.structure));
  assert.equal(structure.fields.find((f) => f.name === "title").filled, true, "the draft text was already there and is unchanged");
  const trace = JSON.parse(read(path.join(root, result.runId), "trace.json"));
  assert.equal(trace.outcome.outcome, "reached_post_page");
  assert.ok(result.console.some((c) => /home exploded/.test(c.text)));
});

test("diagnostic: the other outcomes are named, not guessed", async () => {
  const env = { INDEED_DEBUG_DIR: root };
  const run = (id, testSession) => diagnoseIndeed({ id }, { env, deps: { testSession, timing: QUICK } });

  assert.equal((await run("acct-noentry", fakeSession("/empty"))).outcome, "no_post_entry");
  assert.equal((await run("acct-noform", fakeSession("/noform"))).outcome, "no_form_found");
  assert.equal((await run("acct-expired", async () => ({ isValid: false, reason: "Session expired — redirected to Indeed sign-in" }))).outcome, "session_expired");
  const challenged = await run("acct-check", async () => ({ isValid: false, challenge: true, reason: "Indeed is asking for a verification check" }));
  assert.equal(challenged.outcome, "challenge");
  assert.match(challenged.message, /Nothing else was tried/);
  const broken = await run("acct-broken", async () => { throw new Error("browser exploded\nstack"); });
  assert.equal(broken.outcome, "error");
  assert.match(broken.message, /browser exploded/);
  assert.ok(!broken.message.includes("stack"));
});

test("diagnostic: one at a time per account, a pause between runs, and no window without a screen", async () => {
  const env = { INDEED_DEBUG_DIR: root };
  let release;
  const slow = async () => { await new Promise((resolve) => { release = resolve; }); return { isValid: false, reason: "x" }; };
  let clock = 1_000_000;
  const deps = { testSession: slow, now: () => clock };

  const first = diagnoseIndeed({ id: "acct-gate" }, { env, deps });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(diagnoseIndeed({ id: "acct-gate" }, { env, deps }), (e) => e instanceof DiagnoseError && e.code === "busy");
  release();
  await first;

  await assert.rejects(diagnoseIndeed({ id: "acct-gate" }, { env, deps }), (e) => e.code === "too_soon" && /Wait \d+ seconds/.test(e.message));
  clock += DIAGNOSE_BRAKE_MS + 1;
  const again = diagnoseIndeed({ id: "acct-gate" }, { env, deps });
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await again;

  await assert.rejects(
    diagnoseIndeed({ id: "acct-window" }, { env: { ...env, INDEED_CONNECT_WINDOW: "off" }, visible: true, deps }),
    (e) => e.code === "no_display"
  );
});

// ─── Verification checks: a person may clear one in the window; nothing is ever clicked for them ───

test("waiting for a check only watches the page: it clears, times out, or ends when the window closes", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setContent('<title>Just a moment...</title><script>setTimeout(() => { document.title = "Employer home"; }, 400)</script>');
  const cleared = await waitForCheckToClear(page, { timeoutMs: 5000, pollMs: 100 });
  assert.equal(cleared.cleared, true);

  await page.setContent("<title>Just a moment...</title>");
  const stuck = await waitForCheckToClear(page, { timeoutMs: 400, pollMs: 100 });
  assert.equal(stuck.cleared, false);

  await context.close();
  assert.deepEqual((await waitForCheckToClear(page, { timeoutMs: 400, pollMs: 100 })).cleared, false);
});

test("diagnostic with the window shown waits for the person to clear a check after Post a job, then reads the form", async () => {
  const env = { INDEED_DEBUG_DIR: root, DISPLAY: ":0" };
  const result = await diagnoseIndeed({ id: "acct-cleared" }, { env, visible: true, deps: { testSession: fakeSession("/guarded"), timing: QUICK } });
  assert.equal(result.outcome, "reached_post_page");
  const names = result.steps.map((s) => s.name);
  assert.ok(names.includes("waiting-for-you") && names.includes("check-cleared"));
  assert.match(result.steps.find((s) => s.name === "waiting-for-you").note, /nothing is clicked for you/);
});

test("diagnostic: a check that is not cleared ends as a challenge, and a hidden run does not wait at all", async () => {
  const env = { INDEED_DEBUG_DIR: root, DISPLAY: ":0", INDEED_CHECK_WAIT_SECONDS: "10" };
  const hidden = await diagnoseIndeed({ id: "acct-hidden" }, { env, deps: { testSession: fakeSession("/guarded-stuck"), timing: QUICK } });
  assert.equal(hidden.outcome, "challenge");
  assert.ok(!hidden.steps.some((s) => s.name === "waiting-for-you"), "no window, no waiting");
  assert.match(hidden.message, /Indeed showed a verification check|Cloudflare/);
});

test("check messages say what is known: a Cloudflare block is named, and no claim goes beyond the evidence", () => {
  assert.equal(checkWaitMs({}), 180 * 1000);
  assert.equal(checkWaitMs({ INDEED_CHECK_WAIT_SECONDS: "30" }), 30 * 1000);
  assert.equal(checkWaitMs({ INDEED_CHECK_WAIT_SECONDS: "5" }), 180 * 1000);
  const hidden = challengeMessage({ botCheck: true, visible: false });
  assert.match(hidden, /Cloudflare bot check blocked the hidden browser/);
  assert.match(hidden, /HTTP 403/);
  assert.match(hidden, /only waits for a person to clear a check/);
  assert.match(hidden, /window shown/);
  assert.match(hidden, /has passed it/, "a visible window with a person has passed the check");
  const shown = challengeMessage({ botCheck: true, visible: true, waitedMs: 180000 });
  assert.match(shown, /still showing after 180 seconds/);
  assert.match(shown, /Copy and open/);
  // it must not claim the check can never be completed: that was never shown
  assert.doesNotMatch(shown, /never completes|not possible/);
  assert.doesNotMatch(hidden, /never completes|not possible/);
  assert.match(challengeMessage({ botCheck: false, visible: false }), /verification check/);
});

// ─── Reading a check from the page itself (a stale or empty title must not look like "cleared") ───

test("a check is recognised from the page's own words, not only its title", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setContent("<title>Employer home</title><h1>Additional Verification Required</h1><p>Your Ray ID for this request is abc</p>");
  assert.equal(await pageShowsCheck(page), true, "a normal title over a check page is still a check");
  await page.setContent("<title></title><h1>Additional Verification Required</h1>");
  assert.equal(await pageShowsCheck(page), true, "an empty title does not make it clear");
  await page.setContent("<title>Employer home</title><h1>Your jobs</h1><a href=\"#\">Post a job</a>");
  assert.equal(await pageShowsCheck(page), false);
  await context.close();
});

test("waiting for a check does not call it cleared while the page still shows the check", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  // the title changes to something harmless but the page still asks for verification: this is what Indeed's page did
  await page.setContent('<title>Just a moment...</title><h1>Additional Verification Required</h1><script>setTimeout(() => { document.title = ""; }, 100)</script>');
  const stuck = await waitForCheckToClear(page, { timeoutMs: 700, pollMs: 100 });
  assert.equal(stuck.cleared, false);

  // a flicker of a clean page is not enough either: it must stay clear for consecutive polls
  await page.setContent("<title>Employer home</title><h1>Your jobs</h1>");
  assert.equal((await waitForCheckToClear(page, { timeoutMs: 2000, pollMs: 100 })).cleared, true);
  await context.close();
});
