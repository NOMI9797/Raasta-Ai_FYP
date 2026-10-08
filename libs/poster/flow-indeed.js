// The Indeed "Post a job" form, step by step, as recorded on a signed-in employer account (docs/ai-hiring/19, section 5d).
// A flow says which page is which, how to fill each one, and how to tell that a person is needed. The runner
// (libs/poster/runner.js) does the rest: it never presses the final Confirm, and it stops for a person at every check,
// sign-in and anything it could not fill in and read back.
// Selectors are the stable ones the page report found (data-testid, ids, names); text is matched by role and visible name.
// Relative imports only (also used by the engine process).
import { classifyIndeedUrl, pageShowsCheck } from "../indeed-session-validator";
import { FIELD_STATE as F, GATE } from "./run-model";
import { chooseOption, digitsOf, escapeRegExp, isVisible, norm, numbersIn, pathOf, readValue, squash, waitForPathChange } from "./page-tools";

export const INDEED_START_URL = "https://employers.indeed.com/jobs";

// What a run uses when it is not told otherwise. The kit has no counterpart for these Indeed questions.
export const INDEED_DEFAULTS = Object.freeze({
  openings: 1, // "Number of people to hire in the next 30 days"
  hiringTimeline: "1 to 2 weeks",
  payPeriod: "month", // Indeed's pay form here is per month, in rupees
  currency: "PKR",
  declineSponsorship: true, // answer "No thanks" to the paid plans; a plan is never chosen
  descriptionBudgetMs: 75 * 1000, // a long description is typed faster rather than taking minutes
});

const field = (key, label, state, note, extra = {}) => ({ key, label, state, ...(note ? { note } : {}), ...extra });
const short = (text) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 80);

/** Whether the text read back from a page is what was typed: the same words, allowing for the editor's own formatting. */
export function closeEnough(expected, found) {
  const a = squash(expected);
  const b = squash(found);
  if (!a) return !b;
  if (a === b) return true;
  // A review page shortens long text and says so with an ellipsis: what it shows must be the start of the text
  if (/(…|\.\.\.)\s*$/.test(String(found ?? "").trim())) return b.length >= Math.min(40, a.length) && a.startsWith(b);
  // A rich-text editor adds list markers and line breaks of its own, but shows all of the text
  return b.length >= a.length * 0.97 && b.length <= a.length * 1.05 && a.slice(0, 60) === b.slice(0, 60) && a.slice(-40) === b.slice(-40);
}

const WORKPLACE = [
  [/^(remote|fullyremote)$/, /remote/i],
  [/^hybrid$/, /hybrid/i],
  [/^(onsite|inperson)$/, /in person|on-?site/i],
];
/** The pattern for Indeed's "Job location type" option that matches the job's workplace, or null. */
export function workplaceMatcher(value) {
  const key = norm(value).replace(/[\s_-]/g, "");
  return WORKPLACE.find(([test]) => test.test(key))?.[1] || null;
}

/** The address of the posted job without anything beyond the job's own identifiers. */
export function cleanPostUrl(url) {
  try {
    const parsed = new URL(url);
    const keep = new URLSearchParams();
    for (const key of ["jobId", "id", "jk", "jobKey", "advn"]) {
      if (parsed.searchParams.has(key)) keep.set(key, parsed.searchParams.get(key));
    }
    const query = keep.toString();
    return `${parsed.origin}${parsed.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return null;
  }
}

const PAUSED_ACCOUNT = /paused access to your employer account|your employer account (has been|is) (paused|suspended|restricted|closed)/i;
const RAY_ID = /ray id.{0,60}?([a-f0-9]{12,})/i;

// The start of the page's visible text, or "" when it cannot be read (the page is navigating). A plain string, see page-tools.
async function pageText(page) {
  try {
    return String(await page.evaluate("document.body ? document.body.innerText.slice(0, 2000) : ''"));
  } catch {
    return "";
  }
}

const isRupees = (currency) => !currency || /^(pkr|rs\.?|rupees?)$/i.test(String(currency).trim());

// ── Steps ──

async function openPostAJob({ page, human, sleep }) {
  const link = page.getByRole("button", { name: /^post a job$/i }).or(page.getByRole("link", { name: /^post a job$/i })).filter({ visible: true }).first();
  if (!(await isVisible(link))) return { fields: [field("open", "Open Post a job", F.UNVERIFIED, 'Click "Post a job" yourself')], advance: "auto" };
  const from = pathOf(page.url());
  await human.click(page, link);
  const moved = await waitForPathChange(page, from, { sleep });
  return { fields: [field("open", "Open Post a job", moved ? F.VERIFIED : F.UNVERIFIED, moved ? "" : 'Indeed did not open the form: click "Post a job" yourself')], advance: "auto" };
}

async function chooseFromScratch({ page, human, sleep }) {
  const from = pathOf(page.url());
  const scratch = page.getByText(/from scratch/i).first();
  if (await isVisible(scratch)) {
    await human.click(page, scratch);
    await human.settle();
    const next = page.getByRole("button", { name: /^(continue|next)$/i }).first();
    if (await isVisible(next)) await human.click(page, next);
    if (await waitForPathChange(page, from, { timeoutMs: 8000, sleep })) return { fields: [field("flow", "Start from scratch", F.VERIFIED)], advance: "auto" };
  }
  return { fields: [field("flow", "Start from scratch", F.UNVERIFIED, 'Choose "from scratch" yourself')], advance: "auto" };
}

async function setWorkplace(ctx) {
  const { page, values } = ctx;
  const matcher = workplaceMatcher(values.workplace);
  if (!values.workplace || !matcher) return field("workplace", "Job location type", F.SKIPPED, "The job does not say where the work is done");
  const trigger = page.locator('[data-testid="job-location-type-selector"]').first();
  if (!(await isVisible(trigger))) return field("workplace", "Job location type", F.UNVERIFIED, `Choose "${values.workplace}" yourself`);
  if (matcher.test(await readValue(trigger))) return field("workplace", "Job location type", F.VERIFIED, "already set");
  await chooseOption(ctx, trigger, matcher);
  const found = await readValue(trigger);
  return matcher.test(found)
    ? field("workplace", "Job location type", F.VERIFIED)
    : field("workplace", "Job location type", F.UNVERIFIED, `Choose "${values.workplace}" yourself`);
}

async function setJobTitle(ctx) {
  const { page, human, values } = ctx;
  // The id is what the page report found; the role and name are the fallback if Indeed renames it
  const box = page.locator('input[id^="job-title-input"]').or(page.getByRole("combobox", { name: /^job title/i })).first();
  if (!values.title) return field("title", "Job title", F.UNVERIFIED, "The job has no title");
  if (!(await isVisible(box))) return field("title", "Job title", F.UNVERIFIED, "The title box was not found");
  for (const typos of [true, false]) {
    await human.fillIn(page, box, values.title, { typos });
    await human.settle();
    // Close the suggestion list by clicking something harmless
    const heading = page.getByRole("heading").first();
    if (await isVisible(heading)) await human.click(page, heading);
    if (norm(await readValue(box)) === norm(values.title)) return field("title", "Job title", F.VERIFIED);
  }
  return field("title", "Job title", F.UNVERIFIED, `Indeed shows "${short(await readValue(box))}"`);
}

async function setLocation(ctx) {
  const { page, human, values } = ctx;
  if (!values.location) return field("location", "Location", F.SKIPPED, "The job has no location");
  const box = page.locator('[data-testid="location-input-component"]').or(page.getByRole("combobox", { name: /^what is the job location/i })).first();
  if (!(await isVisible(box))) {
    return /remote/i.test(values.workplace || "")
      ? field("location", "Location", F.SKIPPED, "A remote job has no location box")
      : field("location", "Location", F.UNVERIFIED, "The location box was not found");
  }
  const token = norm(values.location).split(/[\s,]+/)[0];
  await human.fillIn(page, box, values.location, { typos: true });
  const anyOption = page.getByRole("option").first();
  if (await anyOption.waitFor({ state: "visible", timeout: 3000 }).then(() => true, () => false)) {
    await human.settle();
    const match = page.getByRole("option", { name: new RegExp(escapeRegExp(token), "i") }).first();
    await human.click(page, (await isVisible(match)) ? match : anyOption);
    await human.settle();
  }
  const found = await readValue(box);
  return norm(found).includes(token)
    ? field("location", "Location", F.VERIFIED)
    : field("location", "Location", F.UNVERIFIED, `Indeed shows "${short(found)}"`);
}

async function stepBasics(ctx) {
  // The location type first: a different type can change which boxes the page shows
  const fields = [await setWorkplace(ctx), await setJobTitle(ctx), await setLocation(ctx)];
  return { fields, advance: "continue" };
}

async function tickJobType(ctx) {
  const { page, human, values } = ctx;
  const type = values.employmentType;
  if (!type) return field("employmentType", "Job type", F.UNVERIFIED, "The job has no job type: choose one");
  const input = page.getByRole("checkbox", { name: new RegExp(`^${escapeRegExp(type)}$`, "i") }).first();
  if ((await input.count()) === 0) return field("employmentType", "Job type", F.UNVERIFIED, `Tick "${type}" yourself`);
  if (!(await input.isChecked())) {
    const label = page.locator("label", { has: input }).first();
    await human.click(page, (await isVisible(label)) ? label : input);
    await human.settle();
  }
  return (await input.isChecked()) ? field("employmentType", "Job type", F.VERIFIED) : field("employmentType", "Job type", F.UNVERIFIED, `Tick "${type}" yourself`);
}

async function setHiringTimeline(ctx) {
  const { page, options } = ctx;
  const trigger = page.locator('[data-testid="expect-hire-date-input"]').first();
  const wanted = new RegExp(escapeRegExp(options.hiringTimeline), "i");
  if (!(await isVisible(trigger))) return field("timeline", "Hiring timeline", F.UNVERIFIED, `Choose "${options.hiringTimeline}" or what suits you`);
  if (wanted.test(await readValue(trigger))) return field("timeline", "Hiring timeline", F.VERIFIED, "already set");
  await chooseOption(ctx, trigger, wanted);
  return wanted.test(await readValue(trigger))
    ? field("timeline", "Hiring timeline", F.VERIFIED)
    : field("timeline", "Hiring timeline", F.UNVERIFIED, "Choose how soon you want to hire");
}

async function setOpenings(ctx) {
  const { page, human, options } = ctx;
  const box = page.locator('[data-testid="job-hires-needed-input"]').first();
  const want = String(options.openings);
  if (!(await isVisible(box))) return field("openings", "People to hire", F.UNVERIFIED, `Enter ${want} yourself`);
  if (digitsOf(await readValue(box)) !== want) {
    await human.fillIn(page, box, want);
    await human.settle();
  }
  // Indeed's own plus and minus buttons, when typing did not take
  const plus = page.locator('[data-testid="hire-plus-btn"]').first();
  const minus = page.locator('[data-testid="hire-minus-btn"]').first();
  for (let i = 0; i < 20 && digitsOf(await readValue(box)) !== want; i += 1) {
    const current = Number(digitsOf(await readValue(box))) || 0;
    const button = current < Number(want) ? plus : minus;
    if (!(await isVisible(button))) break;
    await human.click(page, button);
  }
  return digitsOf(await readValue(box)) === want ? field("openings", "People to hire", F.VERIFIED) : field("openings", "People to hire", F.UNVERIFIED, `Enter ${want} yourself`);
}

async function stepHiring(ctx) {
  return { fields: [await tickJobType(ctx), await setHiringTimeline(ctx), await setOpenings(ctx)], advance: "continue" };
}

async function stepPay(ctx) {
  const { page, human, values, options } = ctx;
  const min = digitsOf(values.salaryMin);
  const max = digitsOf(values.salaryMax);
  if (!min && !max) {
    // Indeed fills in its own estimate; left alone it would be published as this job's pay
    return { fields: [field("pay", "Pay", F.UNVERIFIED, "The job has no pay. Indeed filled in its own estimate: keep it or change it")], advance: "continue" };
  }
  if (!isRupees(values.currency)) {
    return { fields: [field("pay", "Pay", F.UNVERIFIED, `Indeed's pay form here is in rupees and the job lists ${String(values.currency).toUpperCase()}: enter the pay yourself`)], advance: "continue" };
  }
  if (!min || !max) {
    return { fields: [field("pay", "Pay", F.UNVERIFIED, "The job has only one end of the range: choose how Indeed shows pay and enter it")], advance: "continue" };
  }

  const fields = [];
  const kind = page.locator('[data-testid="pay-type-selector"]').first();
  if (await isVisible(kind)) {
    if (!/range/i.test(await readValue(kind))) await chooseOption(ctx, kind, /range/i);
    fields.push(/range/i.test(await readValue(kind)) ? field("payType", "Show pay by", F.VERIFIED, "Range") : field("payType", "Show pay by", F.UNVERIFIED, 'Choose "Range"'));
  }
  for (const [key, label, selector, digits] of [["salaryMin", "Pay: minimum", "#jobMinimumPayInput", min], ["salaryMax", "Pay: maximum", "#jobMaximumPayInput", max]]) {
    const box = page.locator(selector).first();
    if (!(await isVisible(box))) {
      fields.push(field(key, label, F.UNVERIFIED, `Enter ${digits} yourself`));
      continue;
    }
    await human.fillIn(page, box, digits);
    await human.settle();
    fields.push(digitsOf(await readValue(box)) === digits ? field(key, label, F.VERIFIED) : field(key, label, F.UNVERIFIED, `Indeed shows "${short(await readValue(box))}"`));
  }
  const period = page.locator('[data-testid="pay-period-selector"]').first();
  const wanted = new RegExp(escapeRegExp(options.payPeriod), "i");
  if (await isVisible(period)) {
    if (!wanted.test(await readValue(period))) await chooseOption(ctx, period, wanted);
    fields.push(wanted.test(await readValue(period)) ? field("payPeriod", "Rate", F.VERIFIED, `per ${options.payPeriod}`) : field("payPeriod", "Rate", F.UNVERIFIED, `Choose "per ${options.payPeriod}"`));
  }
  return { fields, advance: "continue" };
}

async function stepDescription(ctx) {
  const { page, human, values, options } = ctx;
  const box = page.getByRole("textbox", { name: /job description/i }).first();
  if (!values.description) return { fields: [field("description", "Job description", F.UNVERIFIED, "The job has no description: write one")], advance: "continue" };
  if (!(await isVisible(box))) return { fields: [field("description", "Job description", F.UNVERIFIED, "The description box was not found")], advance: "continue" };
  await human.fillIn(page, box, values.description, { budgetMs: options.descriptionBudgetMs });
  await human.settle();
  const found = await readValue(box);
  return {
    fields: [closeEnough(values.description, found) ? field("description", "Job description", F.VERIFIED) : field("description", "Job description", F.UNVERIFIED, "The editor does not show the whole text")],
    advance: "continue",
  };
}

const reviewText = (page, testId) => readValue(page.locator(`[data-testid="${testId}"]`));

// Read back what Indeed will publish and compare it with the post. Nothing is clicked here.
async function stepReview(ctx) {
  const { page, values, options } = ctx;
  const fields = [];
  const compare = (key, label, expected, found, same) => {
    if (!expected) return field(key, label, F.SKIPPED, "Nothing to compare");
    if (!found) return field(key, label, F.UNVERIFIED, "Not shown on the review page");
    return same ? field(key, label, F.VERIFIED, undefined, { found: short(found) }) : field(key, label, F.UNVERIFIED, `Indeed shows "${short(found)}"`, { found: short(found) });
  };

  const title = await reviewText(page, "job-title-review-field-action");
  fields.push(compare("title", "Job title", values.title, title, norm(title) === norm(values.title)));

  const place = await reviewText(page, "location-review-field-action");
  const token = norm(values.location).split(/[\s,]+/)[0];
  fields.push(/remote/i.test(values.workplace || "") && !place ? field("location", "Location", F.SKIPPED, "A remote job has no location") : compare("location", "Location", values.location, place, norm(place).includes(token)));

  const type = await reviewText(page, "job-type-review-field-action");
  fields.push(compare("employmentType", "Job type", values.employmentType, type, norm(type).includes(norm(values.employmentType))));

  const pay = await reviewText(page, "pay-review-field-action");
  const min = digitsOf(values.salaryMin);
  const max = digitsOf(values.salaryMax);
  if ((min || max) && isRupees(values.currency)) {
    const shown = numbersIn(pay);
    fields.push(compare("pay", "Pay", `${min} ${max}`, pay, [min, max].filter(Boolean).every((n) => shown.includes(n))));
  } else {
    fields.push(field("pay", "Pay", F.SKIPPED, pay ? `Indeed shows "${short(pay)}"` : "The job has no pay to compare"));
  }

  const description = await reviewText(page, "job-description-review-field-action");
  fields.push(compare("description", "Job description", values.description, description, closeEnough(values.description, description)));

  const openings = await reviewText(page, "number-of-openings-review-field-action");
  fields.push(compare("openings", "People to hire", String(options.openings), openings, digitsOf(openings) === String(options.openings)));

  const method = await reviewText(page, "application-method-review-field-action");
  if (method) {
    fields.push(field("applicationMethod", "How people apply", F.SKIPPED, `${short(method)}. Applicants do not go through Raasta-AI's apply form unless you change this with Edit`, { found: short(method) }));
  }
  return { fields, advance: "confirm" };
}

// The page offers paid plans with one pre-selected. The engine only ever answers "No thanks", and only if told to.
async function stepSponsor(ctx) {
  const { page, human, options, sleep } = ctx;
  const sponsorNote = "Indeed offers paid plans here. Choose \"No thanks\" to post for free; Raasta-AI never picks a plan";
  if (!options.declineSponsorship) return { fields: [field("sponsor", "Sponsorship", F.UNVERIFIED, sponsorNote)], advance: "auto", gateKind: GATE.SPONSOR };
  const from = pathOf(page.url());
  const decline = page.getByRole("button", { name: /^no thanks$/i }).first();
  if (!(await isVisible(decline))) return { fields: [field("sponsor", "Sponsorship", F.UNVERIFIED, sponsorNote)], advance: "auto", gateKind: GATE.SPONSOR };
  await human.click(page, decline);
  // Indeed asks "Are you sure?" with a second "No thanks" (and a credit offer, which is left alone)
  const sure = page.getByRole("button", { name: /^no thanks$/i });
  if ((await sure.count()) > 1 && !(await waitForPathChange(page, from, { timeoutMs: 1500, sleep }))) {
    await human.settle();
    await human.click(page, sure.last());
  }
  const moved = await waitForPathChange(page, from, { timeoutMs: 15000, sleep });
  return {
    fields: [moved ? field("sponsor", "Sponsorship", F.VERIFIED, "declined (no paid plan)") : field("sponsor", "Sponsorship", F.UNVERIFIED, sponsorNote)],
    advance: "auto",
    gateKind: GATE.SPONSOR,
  };
}

async function stepDone({ page }) {
  const status = await readValue(page.locator('[data-testid="top-level-job-status"]'));
  const postUrl = cleanPostUrl(page.url());
  const reviewing = /pending|review/i.test(status);
  return {
    fields: [field("status", "Status on Indeed", F.VERIFIED, short(status) || "job page reached")],
    advance: "done",
    outcome: {
      postUrl,
      indeedStatus: short(status) || null,
      message: `Indeed has the job${status ? ` (status: ${short(status)})` : ""}.${reviewing ? " Indeed is still reviewing it, so it is not live yet." : ""}`,
    },
  };
}

export const INDEED_FLOW = Object.freeze({
  platform: "indeed",
  label: "Indeed",
  startUrl: INDEED_START_URL,
  defaults: INDEED_DEFAULTS,
  afterConfirm: ["sponsor", "done"], // the steps that can only be reached by pressing Confirm on the review page
  steps: [
    { id: "start", label: "Open Post a job", match: /^\/jobs\/?$/, run: openPostAJob },
    { id: "choose", label: "Start from scratch", match: /\/job-posting\/choose-flow/, run: chooseFromScratch },
    { id: "basics", label: "Job basics", match: /\/from-scratch\/getting-started/, run: stepBasics },
    { id: "hiring", label: "Hiring details", match: /\/from-scratch\/hiring-details/, run: stepHiring },
    { id: "pay", label: "Pay and benefits", match: /\/from-scratch\/compensation-details/, run: stepPay },
    { id: "description", label: "Job description", match: /\/from-scratch\/job-description/, run: stepDescription },
    { id: "review", label: "Review", match: /\/from-scratch\/review-job/, run: stepReview, readOnly: true },
    { id: "sponsor", label: "Sponsorship", match: /^\/sponsor\//, run: stepSponsor },
    { id: "done", label: "Job page", match: /^\/jobs\/view/, run: stepDone, readOnly: true },
  ],

  /** The step the page is on, or null for a page the flow does not know. */
  matchStep(url) {
    const path = pathOf(url);
    return this.steps.find((step) => step.match.test(path)) || null;
  },

  /** Why a person is needed before anything else can happen: a verification check or a sign-in. null when the page is fine. */
  async blocker(page) {
    const text = await pageText(page);
    // Seen on 2026-10-08: Indeed pauses an employer account it flags. Nothing can be posted until the owner answers its
    // questions in their own browser, so the run ends here instead of waiting.
    if (PAUSED_ACCOUNT.test(text) || /^\/appeal/.test(pathOf(page.url()))) {
      return {
        kind: GATE.ACCOUNT,
        fatal: true,
        code: "account_paused",
        message: "Indeed has paused this employer account (it cites unusual login activity or insufficient account information), so nothing can be posted until Indeed restores it. Open your employer account in your own browser to see what it asks; Raasta-AI does not fill in that form. Post with Copy and open once it is restored.",
      };
    }
    if (await pageShowsCheck(page)) {
      // Cloudflare's check normally has a widget to complete. A page that only says "Additional Verification Required",
      // with a Ray ID and a Return home button, has nothing to complete: the window itself was refused.
      const widget = page.frames().some((frame) => /challenges\.cloudflare\.com/.test(frame.url()));
      if (!widget && /return home/i.test(text) && /ray id/i.test(text)) {
        const ray = (text.match(RAY_ID) || [])[1];
        return {
          kind: GATE.CHECK,
          blocked: true,
          message: `Indeed's bot protection is blocking this window${ray ? ` (Ray ID ${ray})` : ""} and there is nothing on the page to complete. Close the window and try again later, or post with Copy and open. Repeated attempts can get the account restricted.`,
        };
      }
      return { kind: GATE.CHECK, message: "Indeed is showing a verification check. Complete it in the browser window; Raasta-AI never clicks it for you." };
    }
    if (classifyIndeedUrl(page.url()) === "login") {
      return { kind: GATE.SIGN_IN, message: "Indeed is asking you to sign in. Sign in in the browser window; Raasta-AI never types your password or code. If Google refuses to sign in inside this window, use Indeed's emailed code instead." };
    }
    return null;
  },

  /** The Continue button of a step. */
  continueButton: (page) => page.locator('[data-testid="footer-continue-btn"]').first(),
});
