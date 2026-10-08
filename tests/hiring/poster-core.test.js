import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import path from "node:path";
import { INDEED_FLOW, cleanPostUrl, closeEnough, workplaceMatcher } from "../../libs/poster/flow-indeed";
import { SPEEDS, createHuman, estimateTypingMs, keyDelay, slipFor, speedFrom } from "../../libs/poster/human";
import { digitsOf, numbersIn, squash } from "../../libs/poster/page-tools";
import {
  ENGINE_SLOW_MS, FIELD_STATE, HEARTBEAT_STALE_MS, RUN_MODE, RUN_STATUS, RunError, describeUnverified, fieldTotals, initialSteps, isLive,
  isShotName, kitValues, publicRun, upsertStep,
} from "../../libs/poster/run-model";
import { cleanRunOptions, cooloffGuard, guardRows, startPostingRun } from "../../libs/poster/service";
import { profileDirFor, enginePort, startEngine } from "../../libs/poster/engine";
import { shotPath } from "../../libs/poster/shots";

// ── Human-like input ──

const middle = () => 0.5;

test("key timing: words, punctuation and new lines take longer, a repeated key is quick, and speed off never waits", () => {
  const [low, high] = SPEEDS.natural.key;
  const base = keyDelay("a", "", "natural", middle);
  assert.equal(base, (low + high) / 2);
  assert.ok(keyDelay(" ", "a", "natural", middle) > base);
  assert.ok(keyDelay(".", "a", "natural", middle) > keyDelay(" ", "a", "natural", middle));
  assert.ok(keyDelay("\n", ".", "natural", middle) > keyDelay(".", "a", "natural", middle));
  assert.ok(keyDelay("e", "e", "natural", middle) < base);
  assert.ok(keyDelay("E", "a", "natural", middle) > base);
  assert.equal(keyDelay("a", "", "off", middle), 0);
  assert.ok(keyDelay("a", "", "fast", middle) < base);
  assert.equal(speedFrom("FAST"), "fast");
  assert.equal(speedFrom("warp"), "natural");
});

test("key timing varies from key to key (not a metronome)", () => {
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const delays = Array.from({ length: 40 }, () => keyDelay("a", "b", "natural", rng));
  assert.ok(new Set(delays.map((d) => Math.round(d))).size > 20);
  assert.ok(delays.every((d) => d >= SPEEDS.natural.key[0] && d <= SPEEDS.natural.key[1]));
});

test("a slip hits a key next to the intended one, and keeps the case", () => {
  assert.ok("qwsz".includes(slipFor("a", middle)));
  assert.ok("QWSZ".includes(slipFor("A", middle)));
  assert.equal(slipFor("7", middle), null);
  assert.equal(slipFor(" ", middle), null);
});

// A page that records what was typed (type() adds, Backspace removes, Enter adds a new line) and where the mouse went
function fakePage() {
  const typed = [];
  const mouse = {
    moves: [], downs: 0, ups: 0,
    move: async (x, y) => { mouse.moves.push({ x, y }); },
    down: async () => { mouse.downs += 1; },
    up: async () => { mouse.ups += 1; },
    wheel: async () => {},
  };
  return {
    mouse,
    text: () => typed.join(""),
    keyboard: {
      type: async (char) => { typed.push(char); },
      press: async (key) => {
        if (key === "Backspace") typed.pop();
        else if (key === "Enter") typed.push(String.fromCharCode(10));
      },
    },
  };
}

test("typing: slips are corrected, and the text that comes out is exactly the text that went in", async () => {
  const page = fakePage();
  const human = createHuman({ speed: "natural", rng: () => 0.001, sleep: async () => {} }); // 0.001 < typoRate: a slip before every letter
  const text = "Hello world,\nsecond line.";
  await human.typeText(page, text, { typos: true });
  assert.equal(page.text(), text);
});

test("typing: a long text is typed against a time budget instead of taking minutes", async () => {
  const text = "word ".repeat(400); // 2000 characters
  const slept = [];
  const human = createHuman({ speed: "natural", rng: middle, sleep: async (ms) => { slept.push(ms); } });
  assert.ok(estimateTypingMs(text, "natural") > 200000, "at natural speed this would take several minutes");
  await human.typeText(fakePage(), text, { budgetMs: 60000 });
  const total = slept.reduce((a, b) => a + b, 0);
  assert.ok(total <= 60000 * 1.2, `${Math.round(total)} ms`);
  assert.ok(total > 20000, "still paced like typing, not instant");
});

test("speed off types at once", async () => {
  const slept = [];
  const human = createHuman({ speed: "off", rng: middle, sleep: async (ms) => { slept.push(ms); } });
  const page = fakePage();
  await human.typeText(page, "No waiting here", { typos: true });
  assert.equal(page.text(), "No waiting here");
  assert.equal(slept.length, 0);
});

test("the mouse travels along a curve and ends inside the element, then presses once", async () => {
  const page = fakePage();
  const human = createHuman({ speed: "natural", rng: () => 0.37, sleep: async () => {} });
  const box = { x: 400, y: 300, width: 120, height: 40 };
  const target = { scrollIntoViewIfNeeded: async () => {}, boundingBox: async () => box };
  await human.click(page, target);
  assert.ok(page.mouse.moves.length >= 6, "several steps, not a jump");
  const end = page.mouse.moves.at(-1);
  assert.ok(end.x > box.x && end.x < box.x + box.width && end.y > box.y && end.y < box.y + box.height);
  assert.notEqual(end.x, box.x + box.width / 2, "not the exact middle");
  assert.equal(page.mouse.downs, 1);
  assert.equal(page.mouse.ups, 1);
  const straight = page.mouse.moves.every((p, i, all) => i === 0 || Math.abs((p.y - all[0].y) * (end.x - all[0].x) - (p.x - all[0].x) * (end.y - all[0].y)) < 1e-6);
  assert.equal(straight, false, "the path bends");
});

// ── The run's data ──

test("a run as the panel sees it: no kit, no engine id, and flags for a missing or stopped engine", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  const row = { id: "r", jobId: "j", userId: "u", platform: "indeed", mode: "post", status: "queued", kit: { secret: "job text" }, engineId: "host-1", steps: [], gate: null, createdAt: new Date(now - 20000), heartbeatAt: null };
  const queued = publicRun(row, now);
  assert.equal(queued.waitingForEngine, true);
  assert.equal(queued.live, true);
  assert.equal(JSON.stringify(queued).includes("job text"), false);
  assert.equal(JSON.stringify(queued).includes("host-1"), false);
  assert.equal(publicRun({ ...row, createdAt: new Date(now - ENGINE_SLOW_MS + 2000) }, now).waitingForEngine, false);
  assert.equal(publicRun({ ...row, status: "running", heartbeatAt: new Date(now - HEARTBEAT_STALE_MS - 1000) }, now).stale, true);
  assert.equal(publicRun({ ...row, status: "running", heartbeatAt: new Date(now - 5000) }, now).stale, false);
  assert.equal(publicRun({ ...row, status: "published", heartbeatAt: new Date(now - 999999) }, now).stale, false);
  assert.equal(isLive("needs_you"), true);
  assert.equal(isLive("published"), false);
});

test("the timeline: steps start pending, a patch merges, and fields are summed", () => {
  const steps = initialSteps(INDEED_FLOW);
  assert.deepEqual(steps.map((s) => s.id), ["start", "choose", "basics", "hiring", "pay", "description", "review", "sponsor", "done"]);
  assert.ok(steps.every((s) => s.status === "pending"));
  const next = upsertStep(steps, "basics", { status: "done", fields: [{ key: "title", label: "Job title", state: "verified" }, { key: "location", label: "Location", state: "unverified", note: "x" }, { key: "pay", label: "Pay", state: "skipped" }] });
  assert.equal(steps[2].status, "pending", "the original is not changed");
  assert.equal(next[2].status, "done");
  assert.equal(upsertStep(next, "extra", { label: "Extra" }).at(-1).id, "extra");
  assert.deepEqual(fieldTotals(next), { checked: 2, verified: 1, open: 1 });
  assert.equal(describeUnverified(next[2].fields), "Location: x");
  assert.equal(describeUnverified([]), "");
});

test("kit values, screenshot names and run ids are checked before they become paths", () => {
  assert.deepEqual(kitValues({ fields: [{ key: "title", value: "A" }, { key: "x", value: 5 }] }), { title: "A", x: "5" });
  assert.equal(isShotName("03-description.jpg"), true);
  assert.equal(isShotName("../secret.jpg"), false);
  assert.equal(isShotName("a.png"), false);
  assert.equal(isShotName(""), false);
  const id = "123e4567-e89b-12d3-a456-426614174000";
  const cwd = path.resolve("/work");
  assert.equal(shotPath(id, "01-basics.jpg", { cwd, env: {} }), path.join(cwd, ".runtime", "poster-runs", id, "01-basics.jpg"));
  assert.equal(shotPath("../..", "01-basics.jpg", { cwd, env: {} }), null);
  assert.equal(shotPath(id, "..%2f.jpg", { cwd, env: {} }), null);
});

// ── The Indeed flow's rules ──

test("Indeed pages are matched by path, and an unknown page is not guessed at", () => {
  const at = (p) => INDEED_FLOW.matchStep(`https://employers.indeed.com${p}`)?.id || null;
  assert.equal(at("/jobs"), "start");
  assert.equal(at("/jobs/"), "start");
  assert.equal(at("/jobs/view?jobId=1"), "done");
  assert.equal(at("/job-posting/choose-flow"), "choose");
  assert.equal(at("/job-posting/from-scratch/getting-started"), "basics");
  assert.equal(at("/job-posting/from-scratch/hiring-details"), "hiring");
  assert.equal(at("/job-posting/from-scratch/compensation-details"), "pay");
  assert.equal(at("/job-posting/from-scratch/job-description"), "description");
  assert.equal(at("/job-posting/from-scratch/review-job"), "review");
  assert.equal(at("/sponsor/sponsor/budget-tiers"), "sponsor");
  assert.equal(at("/settings"), null);
  assert.equal(at("/candidates"), null);
});

test("text read back from a page: the same words match, formatting is allowed for, a shortened text must be the start, a different one fails", () => {
  const text = "We are hiring a developer.\n\nAbout the role\n- Build things\n- Ship things\n\nAbout you\n- Care about quality";
  assert.equal(closeEnough(text, text), true);
  assert.equal(closeEnough(text, "We are hiring a developer. About the role • Build things • Ship things About you • Care about quality"), true, "bullets and line breaks are the editor's own");
  assert.equal(closeEnough(text, `${text.slice(0, 60)}…`), true, "a review page shortens long text with an ellipsis");
  assert.equal(closeEnough(text, "We are hiring a designer. About the role"), false);
  assert.equal(closeEnough(text, "We are hiring a developer."), false, "half the text is not the text");
  assert.equal(closeEnough("", ""), true);
  assert.equal(squash("- A, b!"), "a b");
});

test("numbers, work places and links", () => {
  assert.equal(digitsOf("Rs33,000.00"), "33000");
  assert.equal(digitsOf("150,000"), "150000");
  assert.equal(digitsOf("none"), "");
  assert.deepEqual(numbersIn("Rs33,000.00 - Rs200,000.00 per month"), ["33000", "200000"]);
  assert.ok(workplaceMatcher("Onsite").test("In person"));
  assert.ok(workplaceMatcher("On-site").test("In person"));
  assert.ok(workplaceMatcher("Remote").test("Fully remote"));
  assert.ok(workplaceMatcher("Hybrid").test("Hybrid work"));
  assert.equal(workplaceMatcher("on the moon"), null);
  assert.equal(workplaceMatcher(""), null);
  assert.equal(cleanPostUrl("https://employers.indeed.com/jobs/view?jobId=abc&utm_source=x&token=SECRET#frag"), "https://employers.indeed.com/jobs/view?jobId=abc");
  assert.equal(cleanPostUrl("not a url"), null);
});

// ── Starting a run ──

const JOB = { id: "job-1", userId: "user-1", status: "draft", title: "Backend Engineer", location: "Lahore", locationType: "onsite", employmentType: "full-time", salaryMin: 100000, salaryMax: 200000, salaryCurrency: "PKR", indeedPost: "Backend Engineer in Lahore\n\nAbout the role\n- Build and run the services that power our recruitment platform\n- Review code, mentor teammates and keep the system reliable\n- Work with product to shape what ships next" };

// A stand-in database that remembers what was inserted and answers the posting-limit query with `recent`
function fakeDatabase({ recent = [], uniqueClash = false } = {}) {
  const inserted = [];
  return {
    inserted,
    insert: () => ({
      values: (value) => ({
        returning: async () => {
          if (uniqueClash) throw Object.assign(new Error("duplicate"), { code: "23505" });
          inserted.push(value);
          return [{ id: "run-1", status: "queued", ...value }];
        },
      }),
    }),
    select: () => ({ from: () => ({ where: async () => recent }) }),
  };
}

const NOW = new Date("2026-10-07T12:00:00Z");
const ago = (minutes) => new Date(NOW.getTime() - minutes * 60 * 1000);
const refused = (promise, code) => assert.rejects(promise, (error) => error instanceof RunError && error.code === code);

test("start: a queued run carries the posting kit and only the options a person may set", async () => {
  const database = fakeDatabase();
  const run = await startPostingRun({ job: JOB, platform: "indeed", mode: RUN_MODE.REHEARSAL, options: { openings: "3", evil: "x" }, deps: { database, now: () => NOW } });
  assert.equal(run.status, "queued");
  assert.equal(database.inserted.length, 1);
  const stored = database.inserted[0];
  assert.equal(stored.mode, "rehearsal");
  assert.equal(stored.createdAt, NOW, "times come from this process, not the database default");
  assert.equal(stored.platform, "indeed");
  assert.deepEqual(stored.kit.options, { openings: 3 });
  assert.equal(stored.kit.fields.find((f) => f.key === "title").value, "Backend Engineer");
  assert.equal(stored.kit.fields.find((f) => f.key === "description").value, JOB.indeedPost);
});

test("start: refused for another platform, an empty or invalid post, a closed job and bad options", async () => {
  const deps = { database: fakeDatabase(), now: () => NOW };
  await refused(startPostingRun({ job: JOB, platform: "linkedin", deps }), "unsupported_platform");
  await refused(startPostingRun({ job: { ...JOB, indeedPost: "" }, platform: "indeed", deps }), "invalid_post");
  await refused(startPostingRun({ job: { ...JOB, status: "closed" }, platform: "indeed", deps }), "closed");
  await refused(startPostingRun({ job: JOB, platform: "indeed", mode: "yolo", deps }), "invalid_mode");
  await refused(startPostingRun({ job: JOB, platform: "indeed", options: { openings: 0 }, deps }), "invalid_options");
  assert.deepEqual(cleanRunOptions({}), {});
  assert.deepEqual(cleanRunOptions({ openings: 2 }), { openings: 2 });
  assert.throws(() => cleanRunOptions({ openings: 2.5 }), RunError);
  assert.throws(() => cleanRunOptions({ openings: 51 }), RunError);
});

test("start: a second run for the same job is refused with a plain message", async () => {
  await assert.rejects(
    startPostingRun({ job: JOB, platform: "indeed", deps: { database: fakeDatabase({ uniqueClash: true }), now: () => NOW } }),
    (error) => error instanceof RunError && error.code === "in_progress" && error.status === 409 && /already in progress/.test(error.message),
  );
});

test("posting limits count runs that post, not rehearsals or stopped runs", async () => {
  const runs = [
    { mode: "post", status: "published", createdAt: ago(600) },
    { mode: "post", status: "published", createdAt: ago(400) },
    { mode: "rehearsal", status: "rehearsed", createdAt: ago(300) },
    { mode: "post", status: "cancelled", createdAt: ago(200) },
    { mode: "post", status: "needs_you", createdAt: ago(100) },
  ];
  assert.deepEqual(guardRows(runs).map((r) => r.status), ["published", "published", "publishing"]);
  assert.equal(guardRows([{ mode: "post", status: "failed", createdAt: ago(1) }])[0].status, "failed");

  // three posts in the last day: the fourth is refused for a post, but a rehearsal is always allowed
  const full = fakeDatabase({ recent: [0, 1, 2].map((i) => ({ mode: "post", status: "published", createdAt: ago(60 * (i + 2)) })) });
  await assert.rejects(
    startPostingRun({ job: JOB, platform: "indeed", mode: RUN_MODE.POST, deps: { database: full, now: () => NOW } }),
    (error) => error.code === "daily_limit" && error.status === 429 && error.retryAt instanceof Date,
  );
  const run = await startPostingRun({ job: JOB, platform: "indeed", mode: RUN_MODE.REHEARSAL, deps: { database: full, now: () => NOW } });
  assert.equal(run.mode, "rehearsal");
  await assert.rejects(
    startPostingRun({ job: JOB, platform: "indeed", mode: RUN_MODE.POST, deps: { database: fakeDatabase({ recent: [{ mode: "post", status: "published", createdAt: ago(3) }] }), now: () => NOW } }),
    (error) => error.code === "too_soon",
  );
});

// ── The engine process ──

const freePort = () => new Promise((resolve) => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

test("the engine: claims a queued run, hands it to the handler, answers /health, and refuses a second engine on the same port", async () => {
  const port = await freePort();
  const env = { POSTER_ENGINE_PORT: String(port) };
  const queue = [{ id: "run-a", platform: "indeed", userId: "u" }];
  const handled = [];
  const quiet = () => {};
  const engine = await startEngine({
    env,
    log: quiet,
    deps: { reap: async () => {}, claim: async () => queue.shift() || null, handle: async (run) => { handled.push(run.id); } },
  });
  for (let i = 0; i < 50 && handled.length === 0; i += 1) await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(handled, ["run-a"]);
  const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.busy, false);
  assert.ok(health.modes.includes("practice"), "the health answer says which kinds of run this engine knows");
  assert.equal((await fetch(`http://127.0.0.1:${port}/nope`)).status, 404);
  await assert.rejects(startEngine({ env, log: quiet, deps: { reap: async () => {}, claim: async () => null } }), /another posting engine is probably already running/);
  await engine.stop();
});

test("the engine's settings: port, and where each person's browser profile lives", () => {
  assert.equal(enginePort({}), 8095);
  assert.equal(enginePort({ POSTER_ENGINE_PORT: "9100" }), 9100);
  assert.equal(enginePort({ POSTER_ENGINE_PORT: "abc" }), 8095);
  assert.equal(enginePort({ POSTER_ENGINE_PORT: "99999" }), 8095);
  const dir = profileDirFor({ userId: "../../etc/passwd", platform: "indeed", cwd: path.resolve("/work") });
  assert.equal(dir.startsWith(path.join(path.resolve("/work"), ".runtime", "poster-profiles")), true);
  assert.equal(dir.includes(".."), false);
  assert.equal(RUN_STATUS.PUBLISHED, "published");
  assert.equal(FIELD_STATE.VERIFIED, "verified");
});

// ── Leaving an account alone, and the practice site ──

const finished = (code, minutesAgo, mode = "post") => ({ mode, status: "failed", createdAt: ago(minutesAgo + 2), completedAt: ago(minutesAgo), outcome: { code } });

test("after Indeed pauses the account the engine leaves it alone for a day; after a block page for half an hour", () => {
  const paused = cooloffGuard([finished("account_paused", 60)], NOW, {});
  assert.equal(paused.code, "account_paused");
  assert.match(paused.reason, /leaving it alone/);
  assert.match(paused.reason, /Copy and open still works/);
  assert.equal(paused.retryAt.getTime(), ago(60).getTime() + 24 * 60 * 60 * 1000);
  assert.equal(cooloffGuard([finished("account_paused", 25 * 60)], NOW, {}), null, "a day later it may try again");
  assert.equal(cooloffGuard([finished("account_paused", 60)], NOW, { POSTER_PAUSED_COOLOFF_HOURS: "0.5" }), null, "the setting changes the time");
  const blocked = cooloffGuard([finished("blocked", 10)], NOW, {});
  assert.equal(blocked.code, "blocked");
  assert.match(blocked.reason, /Try again in 20 minutes/);
  assert.equal(cooloffGuard([finished("blocked", 31)], NOW, {}), null);
  assert.equal(cooloffGuard([finished("timed_out", 5), finished("cancelled", 5)], NOW, {}), null, "other endings are not a refusal");
  assert.equal(cooloffGuard([], NOW, {}), null);
  // the newest refusal is the one reported
  assert.equal(cooloffGuard([finished("blocked", 20), finished("account_paused", 90)], NOW, {}).code, "blocked");
});

test("start: refused during the cool-off for a rehearsal and a post, but a practice run never touches the platform", async () => {
  const database = fakeDatabase({ recent: [finished("account_paused", 30)] });
  const deps = { database, now: () => NOW, env: {} };
  for (const mode of [RUN_MODE.REHEARSAL, RUN_MODE.POST]) {
    await assert.rejects(startPostingRun({ job: JOB, platform: "indeed", mode, deps }), (e) => e instanceof RunError && e.code === "account_paused" && e.status === 429 && e.retryAt instanceof Date);
  }
  const practice = await startPostingRun({ job: JOB, platform: "indeed", mode: RUN_MODE.PRACTICE, deps });
  assert.equal(practice.mode, "practice");
  assert.deepEqual(database.inserted.at(-1).kit.options, { practiceCheck: true }, "the practice site shows a check so the hand-over can be seen");
});

test("practice options: the check is on unless switched off, and other modes never get it", () => {
  assert.deepEqual(cleanRunOptions({}, RUN_MODE.PRACTICE), { practiceCheck: true });
  assert.deepEqual(cleanRunOptions({ practiceCheck: false, openings: 3 }, RUN_MODE.PRACTICE), { openings: 3 });
  assert.deepEqual(cleanRunOptions({ practiceCheck: true }, RUN_MODE.POST), {});
  assert.equal(guardRows([{ mode: "practice", status: "published", createdAt: ago(1) }]).length, 0, "a practice run is never a post");
});

// ── A second platform ──

test("the engine now has a flow and a practice site for Rozee.pk as well as Indeed", async () => {
  const { ENGINE_PLATFORMS } = await import("../../libs/poster/run-model");
  const { FLOWS } = await import("../../libs/poster/engine");
  const { installPractice } = await import("../../libs/poster/practice");
  assert.deepEqual([...ENGINE_PLATFORMS], ["indeed", "rozee"]);
  assert.deepEqual(Object.keys(FLOWS).sort(), ["indeed", "rozee"]);
  for (const platform of ENGINE_PLATFORMS) {
    const flow = FLOWS[platform];
    assert.equal(flow.platform, platform);
    assert.equal(typeof flow.matchStep, "function");
    assert.equal(typeof flow.blocker, "function");
    assert.ok(flow.steps.length >= 7 && flow.steps.every((s) => s.id && s.label && s.match && s.run));
    assert.ok(flow.startUrl.startsWith("https://"));
  }
  await assert.rejects(installPractice({}, "glassdoor"), /no practice site for glassdoor/);
});

test("start: a Rozee.pk run is queued from the saved Rozee post, and the cool-off names Rozee.pk", async () => {
  const job = { ...JOB, id: "job-2", rozeePost: JOB.indeedPost, indeedPost: "" };
  const database = fakeDatabase();
  const run = await startPostingRun({ job, platform: "rozee", mode: RUN_MODE.REHEARSAL, deps: { database, now: () => NOW, env: {} } });
  assert.equal(run.platform, "rozee");
  assert.equal(database.inserted[0].kit.platform, "rozee");
  assert.equal(database.inserted[0].kit.fields.find((f) => f.key === "description").value, job.rozeePost);
  assert.deepEqual(database.inserted[0].kit.options, {}, "no Indeed-only choices");
  await refused(startPostingRun({ job: { ...job, rozeePost: "" }, platform: "rozee", deps: { database, now: () => NOW, env: {} } }), "invalid_post");

  const resting = fakeDatabase({ recent: [finished("blocked", 5)] });
  await assert.rejects(
    startPostingRun({ job, platform: "rozee", deps: { database: resting, now: () => NOW, env: {} } }),
    (e) => e.code === "blocked" && /^Rozee\.pk's bot protection refused the last window/.test(e.message),
  );
});
