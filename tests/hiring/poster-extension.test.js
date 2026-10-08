import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { chromium } from "playwright";
import { buildPostingKit } from "../../libs/hiring/posting-kit";

const EXT = path.resolve("extensions/raasta-poster");
const read = (file) => fs.readFileSync(path.join(EXT, file), "utf8");

// The extension's libraries are classic scripts that publish themselves on globalThis
vm.runInThisContext(read("lib/kit.js"));
const KIT = globalThis.RaastaPosterKit;

const job = {
  id: "job-42",
  title: "Senior Backend Engineer",
  requiredSkills: ["Node.js", "PostgreSQL"],
  location: "Lahore",
  locationType: "hybrid",
  employmentType: "full-time",
  salaryMin: 300000,
  salaryMax: 450000,
  salaryCurrency: "PKR",
};
const POST = "Senior Backend Engineer in Lahore\n\nAbout the role\n- Build APIs\n\nHow to apply: https://raasta.example/apply/job-42";
const kitFor = (platform = "indeed") => buildPostingKit({ job, platform, postText: POST, applyUrl: "https://raasta.example/apply/job-42" });

// ─── The kit, as the extension checks it ───

test("extension: it accepts what Raasta-AI builds, and keeps only known properties as plain strings", () => {
  const checked = KIT.validate({ ...kitFor("indeed"), evil: "<img src=x onerror=alert(1)>" });
  assert.equal(checked.ok, true);
  assert.deepEqual(Object.keys(checked.kit).sort(), ["createdAt", "entryUrl", "expiresAt", "fields", "jobId", "jobTitle", "place", "platform", "platformLabel", "version"].sort());
  assert.equal(checked.kit.entryUrl, "https://employers.indeed.com/jobs");
  assert.equal(checked.kit.fields.find((f) => f.key === "description").value, POST);
  assert.equal(KIT.validate(kitFor("rozee")).ok, true);
});

test("extension: it refuses what it should not use", () => {
  const good = kitFor("indeed");
  const refuses = (kit, pattern) => { const r = KIT.validate(kit); assert.equal(r.ok, false); assert.match(r.error, pattern); };
  refuses(null, /empty/);
  refuses({ ...good, version: 2 }, /different version/);
  refuses({ ...good, platform: "linkedin" }, /not supported/);
  refuses({ ...good, fields: [] }, /no fields/);
  refuses({ ...good, expiresAt: "2020-01-01T00:00:00Z" }, /expired/);
  refuses({ ...good, createdAt: "nonsense" }, /valid dates/);
  refuses({ ...good, fields: [{ key: "", label: "", value: "" }] }, /no usable fields/);
  // a link to somewhere else is dropped, not followed; a kit cannot live longer than four hours
  assert.equal(KIT.validate({ ...good, entryUrl: "https://evil.example/jobs" }).kit.entryUrl, "");
  assert.equal(KIT.validate({ ...good, entryUrl: "http://employers.indeed.com/jobs" }).kit.entryUrl, "");
  const long = KIT.validate({ ...good, expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString() });
  assert.ok(new Date(long.kit.expiresAt).getTime() - Date.now() <= 4 * 3600 * 1000 + 1000);
});

test("extension: a page is matched to its platform by host name, and look-alike hosts are not", () => {
  assert.equal(KIT.platformForHost("employers.indeed.com"), "indeed");
  assert.equal(KIT.platformForHost("pk.indeed.com"), "indeed");
  assert.equal(KIT.platformForHost("hiring.rozee.pk"), "rozee");
  assert.equal(KIT.platformForHost("www.rozeegpt.ai"), "rozee");
  assert.equal(KIT.platformForHost("indeed.com.evil.example"), null);
  assert.equal(KIT.platformForHost("notindeed.com"), null);
  assert.equal(KIT.platformForHost("localhost"), null);
});

// ─── Filling a form ───

let browser;
let userDataDir;

before(async () => {
  browser = await chromium.launch({ headless: true });
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "raasta-poster-test-"));
});

after(async () => {
  await browser?.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

const FORM = `<!doctype html><title>Post a job</title><body>
  <form id="f">
    <label for="t">Job title</label><input id="t">
    <label>Job location <input name="loc"></label>
    <input aria-label="Minimum pay per month">
    <input placeholder="Maximum salary">
    <label for="d">Job description</label><div id="d" contenteditable="true" role="textbox" style="min-height:40px;border:1px solid"></div>
    <label for="jt">Job type</label><select id="jt"><option>Part-time</option><option>Full-time</option><option>Contract</option></select>
    <label for="edu">Minimum education</label><input id="edu">
    <label for="pw">Job title password</label><input id="pw" type="password">
    <button id="post" type="submit">Post</button>
  </form>
  <script>
    window.__seen = {}; window.__clicked = false; window.__submitted = false;
    document.querySelectorAll("input").forEach((el, i) => el.addEventListener("input", () => { window.__seen[el.id || el.name || "i" + i] = el.value; }));
    document.getElementById("d").addEventListener("input", (e) => { window.__seen.description = e.target.innerText; });
    document.getElementById("post").addEventListener("click", () => { window.__clicked = true; });
    document.getElementById("f").addEventListener("submit", (e) => { window.__submitted = true; e.preventDefault(); });
  </script></body>`;

async function formPage() {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setContent(FORM);
  await page.addScriptTag({ path: path.join(EXT, "lib/kit.js") });
  await page.addScriptTag({ path: path.join(EXT, "lib/fill.js") });
  return { context, page };
}

test("fill: finds fields by their visible names, types like a person, and never clicks or submits", async () => {
  const { context, page } = await formPage();
  const kit = KIT.validate(kitFor("indeed")).kit;
  const results = await page.evaluate((k) => globalThis.RaastaPosterFill.fillKit(document, k), kit);
  const by = Object.fromEntries(results.map((r) => [r.key, r.status]));
  assert.deepEqual(by, { title: "filled", location: "filled", employmentType: "filled", salaryMin: "filled", salaryMax: "filled", description: "filled", salary: "not_found" });

  const values = await page.evaluate(() => ({
    title: document.getElementById("t").value,
    loc: document.querySelector("[name=loc]").value,
    min: document.querySelector("[aria-label^='Minimum pay']").value,
    max: document.querySelector("[placeholder='Maximum salary']").value,
    type: document.getElementById("jt").value,
    description: document.getElementById("d").innerText,
    education: document.getElementById("edu").value,
    password: document.getElementById("pw").value,
    seen: window.__seen,
    clicked: window.__clicked,
    submitted: window.__submitted,
  }));
  assert.equal(values.title, "Senior Backend Engineer");
  assert.equal(values.loc, "Lahore");
  assert.equal(values.min, "300000");
  assert.equal(values.max, "450000");
  assert.equal(values.type, "Full-time");
  assert.match(values.description, /About the role/);
  assert.match(values.description, /How to apply: https:\/\/raasta\.example\/apply\/job-42/);
  assert.equal(values.education, "", "a field that only looks like pay is left alone");
  assert.equal(values.password, "", "passwords are never touched");
  assert.equal(values.seen.t, "Senior Backend Engineer", "the page's own input handlers saw the typing");
  assert.ok(values.seen.description.includes("About the role"));
  assert.equal(values.clicked, false);
  assert.equal(values.submitted, false);
  await context.close();
});

test("fill: leaves what the person already typed, unless told to overwrite", async () => {
  const { context, page } = await formPage();
  await page.fill("#t", "My own title");
  const kit = KIT.validate(kitFor("indeed")).kit;
  const kept = await page.evaluate((k) => globalThis.RaastaPosterFill.fillKit(document, k), kit);
  assert.equal(kept.find((r) => r.key === "title").status, "kept");
  assert.equal(await page.inputValue("#t"), "My own title");
  const over = await page.evaluate((k) => globalThis.RaastaPosterFill.fillKit(document, k, { overwrite: true }), kit);
  assert.equal(over.find((r) => r.key === "title").status, "filled");
  assert.equal(await page.inputValue("#t"), "Senior Backend Engineer");
  await context.close();
});

test("fill: a page with none of the fields says so for each, so the person uses Copy", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setContent("<title>Other</title><h1>Hello</h1><p>No form here</p>");
  await page.addScriptTag({ path: path.join(EXT, "lib/kit.js") });
  await page.addScriptTag({ path: path.join(EXT, "lib/fill.js") });
  const kit = KIT.validate(kitFor("rozee")).kit;
  const results = await page.evaluate((k) => globalThis.RaastaPosterFill.fillKit(document, k), kit);
  assert.ok(results.length > 0 && results.every((r) => r.status === "not_found"));
  await context.close();
});

// ─── The whole thing: the extension loaded in Chromium, a Raasta-AI page on one side, an Indeed form on the other ───

const RAASTA_ORIGIN = "http://localhost:8085";
const PAGE_HTML = `<!doctype html><title>Raasta test</title><script type="module">
  import * as bridge from "/poster-bridge.js"; window.bridge = bridge; window.ready = true;
</script>`;
const INDEED_HTML = FORM.replace("<title>Post a job</title>", "<title>Post a job | Indeed</title>");

async function withExtension(run) {
  // A fresh browser profile per test: the extension keeps its kits in the profile, and one test must not see another's
  const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(userDataDir, "profile-")), {
    channel: "chromium", // the new headless mode, the only headless one that runs extensions
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  try {
    await context.route(`${RAASTA_ORIGIN}/**`, (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/poster-bridge.js") return route.fulfill({ contentType: "text/javascript", body: fs.readFileSync("libs/poster-bridge.js", "utf8") });
      return route.fulfill({ contentType: "text/html", body: PAGE_HTML });
    });
    await context.route("https://employers.indeed.com/**", (route) => route.fulfill({ contentType: "text/html", body: INDEED_HTML }));
    await run(context);
  } finally {
    await context.close();
  }
}

test("extension end to end: Raasta-AI sends the kit, the panel appears on Indeed, fills, copies, and reports the post back", { timeout: 90000 }, async (t) => {
  await withExtension(async (context) => {
    const raasta = await context.newPage();
    await raasta.goto(`${RAASTA_ORIGIN}/poster-test`);
    await raasta.waitForFunction(() => window.ready);

    // 1. Raasta-AI finds the extension
    const found = await raasta.evaluate(() => window.bridge.detectPoster());
    assert.equal(found.installed, true);
    assert.equal(found.version, JSON.parse(read("manifest.json")).version);

    // 2. a bad kit is refused with a reason; a good one is stored
    const refused = await raasta.evaluate(async (kit) => { try { await window.bridge.sendKit(kit); return "sent"; } catch (e) { return e.message; } }, { ...kitFor("indeed"), platform: "linkedin" });
    assert.match(refused, /not supported/);
    await raasta.evaluate((kit) => window.bridge.sendKit(kit), kitFor("indeed"));

    // 3. on the Indeed page the panel appears, with the job and every field
    const indeed = await context.newPage();
    await indeed.goto("https://employers.indeed.com/jobs");
    const panel = indeed.locator("[data-raasta-poster]");
    await panel.waitFor({ state: "attached", timeout: 15000 });
    await indeed.getByText("Senior Backend Engineer", { exact: true }).first().waitFor();
    await indeed.getByText("Nothing is submitted for you", { exact: false }).waitFor();
    assert.ok(await indeed.getByRole("button", { name: "Copy Job title" }).isVisible());
    assert.ok(await indeed.getByRole("button", { name: "Copy Job description" }).isVisible());

    // 4. Fill puts the values in the form and leaves the platform's own button alone
    await indeed.getByRole("button", { name: "Fill the form" }).click();
    await indeed.getByText(/Filled: Job title/).waitFor();
    // fields that belong to a later step are mentioned once, quietly, not listed as problems
    await indeed.getByText(/Not on this page: /).waitFor();
    assert.equal(await indeed.inputValue("#t"), "Senior Backend Engineer");
    assert.equal(await indeed.evaluate(() => window.__clicked || window.__submitted), false);

    // 5. Copy reaches the clipboard (or says to press Ctrl+C when the browser refuses)
    await indeed.getByRole("button", { name: "Copy Job title" }).click();
    await indeed.getByRole("button", { name: /Copied|Press Ctrl\+C/ }).first().waitFor();

    // 6. "I posted it" is remembered; the Raasta-AI page picks it up once and acknowledges it
    await indeed.getByRole("button", { name: "I posted it" }).click();
    await indeed.getByText(/Raasta-AI marks the job as posted/).waitFor();
    const claimed = await raasta.evaluate(() => window.bridge.pollConfirmations());
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].jobId, "job-42");
    assert.equal(claimed[0].platform, "indeed");
    assert.equal(claimed[0].postUrl, "", "no link was typed, so none is invented");
    await raasta.evaluate((ids) => window.bridge.ackConfirmations(ids), claimed.map((c) => c.id));
    assert.deepEqual(await raasta.evaluate(() => window.bridge.pollConfirmations()), []);

    // 7. the kit is used up: a fresh page on Indeed shows no panel
    const again = await context.newPage();
    await again.goto("https://employers.indeed.com/jobs");
    await again.waitForTimeout(800);
    assert.equal(await again.locator("[data-raasta-poster]").count(), 0);
  });
});

test("extension end to end: no panel on a platform page without a kit for it, and a Rozee kit stays off Indeed", { timeout: 90000 }, async () => {
  await withExtension(async (context) => {
    const raasta = await context.newPage();
    await raasta.goto(`${RAASTA_ORIGIN}/poster-test`);
    await raasta.waitForFunction(() => window.ready);
    await raasta.evaluate((kit) => window.bridge.sendKit(kit), kitFor("rozee"));
    const indeed = await context.newPage();
    await indeed.goto("https://employers.indeed.com/jobs");
    await indeed.waitForTimeout(1000);
    assert.equal(await indeed.locator("[data-raasta-poster]").count(), 0, "a Rozee.pk kit is not offered on Indeed");
  });
});

// ─── The page report: what a person pastes so Fill can be tuned against a real form ───

test("report: describes the form by names and selectors, says what would go where, and holds no typed values", async () => {
  const { context, page } = await formPage();
  await page.fill("#edu", "my private education answer");
  await page.fill("#pw", "hunter2");
  const kit = KIT.validate(kitFor("indeed")).kit;
  const report = await page.evaluate((k) => globalThis.RaastaPosterFill.report(document, k, { version: "9.9.9" }), kit);
  const text = JSON.stringify(report);

  assert.equal(report.kind, "raasta-poster-page-report");
  assert.equal(report.platform, "indeed");
  assert.equal(report.title, "Post a job");
  assert.equal(report.extension.version, "9.9.9");
  const title = report.fields.find((f) => f.hint === "#t");
  assert.deepEqual(title.names, ["job title"]);
  assert.equal(title.wouldFill, "title");
  assert.equal(report.fields.find((f) => f.hint === "#d").wouldFill, "description");
  assert.equal(report.fields.find((f) => f.hint === "#jt").wouldFill, "employmentType");
  assert.equal(report.fields.find((f) => f.hint === "#edu").wouldFill, null, "the education box is not mistaken for pay");
  assert.equal(report.fields.find((f) => f.hint === "#edu").filled, true, "it says the box has text, not what the text is");
  assert.equal(report.fields.find((f) => f.hint === "#pw"), undefined, "password boxes are not even listed");
  assert.deepEqual(report.kitFieldsWithNoMatch, ["salary"]);
  assert.equal(report.buttons[0].text, "Post");
  assert.ok(!text.includes("my private education answer") && !text.includes("hunter2"), "no typed values anywhere in the report");
  // nothing was filled just by asking for a report
  assert.equal(await page.inputValue("#t"), "");
  await context.close();
});

test("extension end to end: Copy page report puts the report on the clipboard from the panel", { timeout: 90000 }, async () => {
  await withExtension(async (context) => {
    const raasta = await context.newPage();
    await raasta.goto(`${RAASTA_ORIGIN}/poster-test`);
    await raasta.waitForFunction(() => window.ready);
    await raasta.evaluate((kit) => window.bridge.sendKit(kit), kitFor("indeed"));
    const indeed = await context.newPage();
    await indeed.goto("https://employers.indeed.com/jobs");
    await indeed.locator("[data-raasta-poster]").waitFor({ state: "attached", timeout: 15000 });
    await indeed.getByRole("button", { name: "Copy page report" }).click();
    // either the clipboard took it ("Report copied") or the panel shows it in a box to copy by hand
    await indeed.locator("button, textarea").filter({ hasText: /Report copied/ }).or(indeed.locator("textarea[aria-label='Page report to copy']")).first().waitFor({ timeout: 10000 });
  });
});

// ─── Indeed's job type is a row of tick-box chips, not a box ───

const CHIPS = `<!doctype html><title>Add hiring details</title><body>
  <h1>Add hiring details</h1>
  <fieldset><legend>Job type *</legend>
    <label for="c1"><span>+</span> Contract</label><input type="checkbox" id="c1" style="opacity:0;position:absolute">
    <label for="c2"><span>+</span> Part-time</label><input type="checkbox" id="c2" style="opacity:0;position:absolute">
    <label for="c3"><span>+</span> Full-time</label><input type="checkbox" id="c3" style="opacity:0;position:absolute">
  </fieldset>
  <button id="next" type="button">Continue</button>
  <script>
    window.__ticked = []; window.__buttonClicks = 0;
    document.querySelectorAll("input[type=checkbox]").forEach((el) => el.addEventListener("change", () => window.__ticked.push(el.id + ":" + el.checked)));
    document.getElementById("next").addEventListener("click", () => { window.__buttonClicks++; });
  </script></body>`;

async function chipsPage() {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setContent(CHIPS);
  await page.addScriptTag({ path: path.join(EXT, "lib/kit.js") });
  await page.addScriptTag({ path: path.join(EXT, "lib/fill.js") });
  return { context, page };
}

test("fill: ticks the job type option with the same name, and never presses Continue", async () => {
  const { context, page } = await chipsPage();
  const kit = KIT.validate(kitFor("indeed")).kit; // job type "Full-time"
  const results = await page.evaluate((k) => globalThis.RaastaPosterFill.fillKit(document, k), kit);
  assert.equal(results.find((r) => r.key === "employmentType").status, "filled");
  assert.deepEqual(await page.evaluate(() => window.__ticked), ["c3:true"]);
  assert.equal(await page.isChecked("#c3"), true);
  assert.equal(await page.isChecked("#c2"), false);
  assert.equal(await page.evaluate(() => window.__buttonClicks), 0);
  await context.close();
});

test("fill: an option that is already chosen is left alone, and the report says which option it would tick", async () => {
  const { context, page } = await chipsPage();
  await page.check("#c3", { force: true });
  const kit = KIT.validate(kitFor("indeed")).kit;
  const again = await page.evaluate((k) => globalThis.RaastaPosterFill.fillKit(document, k), kit);
  assert.equal(again.find((r) => r.key === "employmentType").status, "kept");
  assert.deepEqual(await page.evaluate(() => window.__ticked), ["c3:true"], "nothing was toggled off or on again");

  await page.uncheck("#c3", { force: true });
  const report = await page.evaluate((k) => globalThis.RaastaPosterFill.report(document, k), kit);
  const chip = report.fields.find((f) => f.names.includes("+ full-time") || f.names.includes("full-time"));
  assert.equal(chip.wouldFill, "employmentType");
  await context.close();
});

test("extension end to end: each step of the real Indeed flow gets its own tip, and other pages get none", { timeout: 90000 }, async () => {
  await withExtension(async (context) => {
    const raasta = await context.newPage();
    await raasta.goto(`${RAASTA_ORIGIN}/poster-test`);
    await raasta.waitForFunction(() => window.ready);
    await raasta.evaluate((kit) => window.bridge.sendKit(kit), kitFor("indeed"));

    const indeed = await context.newPage();
    const tipOn = async (path) => {
      await indeed.goto(`https://employers.indeed.com${path}`);
      await indeed.locator("[data-raasta-poster]").waitFor({ state: "attached", timeout: 15000 });
      return indeed.locator("[data-raasta-poster] >> .tip").allInnerTexts();
    };
    assert.deepEqual(await tipOn("/jobs"), [], "the job list has no tip");
    assert.match((await tipOn("/job-posting/from-scratch/getting-started?jobId=x"))[0], /Job location type is a drop-down/);
    assert.match((await tipOn("/job-posting/from-scratch/review-job"))[0], /Application method.*Raasta-AI/);
    assert.match((await tipOn("/sponsor/sponsor/budget-tiers"))[0], /paid Sponsored plan.*No thanks/);
    assert.match((await tipOn("/jobs/view?jobId=x"))[0], /I posted it/);

    // moving to another step without a reload (these flows are single-page apps) changes the tip
    await indeed.evaluate(() => history.pushState({}, "", "/job-posting/from-scratch/hiring-details"));
    await indeed.waitForFunction(() => document.querySelector("[data-raasta-poster]").shadowRoot.textContent.includes("hiring timeline"), null, { timeout: 5000 });
  });
});
