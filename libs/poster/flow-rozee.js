// Rozee.pk's "post a job" as it is today, recorded on 2026-10-08 on a signed-in employer account (docs/ai-hiring/19, section 5g).
// The old hiring.rozee.pk form is gone: a signed-in employer posts through RozeeGPT, an AI wizard on www.rozeegpt.ai.
//   dashboard -> "Post A New Job" -> a drawer with one question per page (each has its own address under /postjob/):
//   job title, skills, experience, gender preference, managing others, other requirements, city and workplace, budget
//   -> Rozee's AI writes a DRAFT job, opened at /employer/job/app/<id>/description, where every section edits in place and
//   saves by itself -> "Publish Job" -> a dialog that applies one of the account's free Featured Job credits ("Post with free
//   Featured Job credit"), or sells an upgrade ("Upgrade to Top Job").
// The engine fills the wizard in, replaces the AI's description with the recruiter's post, reads the draft back, and stops.
// Publishing, and every choice in the publish dialog, is the recruiter's: it spends a credit and puts the job live.
// Relative imports only (also used by the engine process).
import { pageShowsCheck } from "../indeed-session-validator";
import { FIELD_STATE as F, GATE } from "./run-model";
import { chooseOption, digitsOf, escapeRegExp, isVisible, norm, numbersIn, pathOf, readValue, waitForPathChange } from "./page-tools";
import { closeEnough } from "./flow-indeed";

export const ROZEE_START_URL = "https://www.rozeegpt.ai/employer/dashboard";

// What a run uses when it is not told otherwise. The kit has no counterpart for these questions.
export const ROZEE_DEFAULTS = Object.freeze({
  genderPreference: "No Preference", // never narrowed: the wizard asks, the job does not say
  manageEmployees: "No",
  otherRequirements: "No other requirements.",
  experienceYears: 1, // when the job gives no experience range
  maxSkills: 6,
  currency: "PKR",
  descriptionBudgetMs: 90 * 1000, // a long description is typed faster rather than taking minutes
  generationWaitMs: 90 * 1000, // Rozee's AI writes the draft after the last question
});

const field = (key, label, state, note, extra = {}) => ({ key, label, state, ...(note ? { note } : {}), ...extra });
const short = (text) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
const isRupees = (currency) => !currency || /^(pkr|rs\.?|rupees?)$/i.test(String(currency).trim());

/** The least experience in a range as a whole number of years: "2-4 years" and "2+ years" give 2, "none" gives the fallback. */
export function minimumYears(text, fallback = ROZEE_DEFAULTS.experienceYears) {
  const match = String(text ?? "").match(/\d+/);
  return match ? Number(match[0]) : fallback;
}

/** The skills of the job as a clean list, in the order they were written, without repeats. */
export function skillList(value) {
  const seen = new Set();
  return String(value ?? "")
    .split(",")
    .map((skill) => skill.trim())
    .filter((skill) => skill && !seen.has(norm(skill)) && seen.add(norm(skill)));
}

const WORKPLACE = [
  [/^(onsite|inperson)$/, /^on-?site$/i],
  [/^hybrid$/, /^hybrid$/i],
  [/^(remote|fullyremote)$/, /^remote$/i],
];
/** The pattern for Rozee's On-Site, Hybrid or Remote choice that matches the job's workplace, or null. */
export function workplaceChip(value) {
  const key = norm(value).replace(/[\s_-]/g, "");
  return WORKPLACE.find(([test]) => test.test(key))?.[1] || null;
}

const PUBLIC_LINK = /https:\/\/www\.rozeegpt\.ai\/[a-z0-9-]+-\d+/i;

const buttonNamed = (page, name) => page.getByRole("button", { name, exact: true });

// The wizard's arrow: an icon-only button at the end of the box. Pressing Enter is the fallback.
async function submitBox(page, human, input) {
  const arrow = page.locator(".MuiInputBase-root", { has: input }).locator("button").first();
  if (await isVisible(arrow)) {
    await human.click(page, arrow);
    return;
  }
  await page.keyboard.press("Enter");
}

async function typeInto(ctx, selector, value, { typos = true } = {}) {
  const { page, human } = ctx;
  const box = page.locator(selector).first();
  if (!(await isVisible(box))) return { box, ok: false, found: "" };
  await human.fillIn(page, box, value, { typos });
  await human.settle();
  const found = await readValue(box);
  return { box, ok: norm(found) === norm(value), found };
}

// ── Steps ──

async function openWizard({ page, human, sleep }) {
  const button = page.getByRole("button", { name: /^post a new job$/i }).filter({ visible: true }).first();
  if (!(await isVisible(button))) return { fields: [field("open", "Open Post A New Job", F.UNVERIFIED, 'Click "Post A New Job" yourself')], advance: "auto" };
  const from = pathOf(page.url());
  await human.click(page, button);
  const moved = await waitForPathChange(page, from, { sleep });
  return { fields: [field("open", "Open Post A New Job", moved ? F.VERIFIED : F.UNVERIFIED, moved ? "" : 'Rozee.pk did not open the wizard: click "Post A New Job" yourself')], advance: "auto" };
}

async function stepJobTitle(ctx) {
  const { page, human, values } = ctx;
  if (!values.title) return { fields: [field("title", "Job title", F.UNVERIFIED, "The job has no title")], advance: "auto" };
  const typed = await typeInto(ctx, 'input[name="jobTitle"]', values.title);
  if (!typed.box || !(await isVisible(typed.box))) return { fields: [field("title", "Job title", F.UNVERIFIED, "The title box was not found")], advance: "auto" };
  // "Use AI to Optimize Job Title" changes the title Rozee keeps: the recruiter's wording stays as written
  const optimise = page.getByLabel(/optimi[sz]e job title/i).first();
  if ((await optimise.count()) && (await optimise.isChecked().catch(() => false))) await human.click(page, optimise);
  const fields = [typed.ok ? field("title", "Job title", F.VERIFIED) : field("title", "Job title", F.UNVERIFIED, `Rozee.pk shows "${short(typed.found)}"`)];
  if (typed.ok) await submitBox(page, human, typed.box);
  return { fields, advance: "auto" };
}

async function stepSkills(ctx) {
  const { page, human, values, options } = ctx;
  const wanted = skillList(values.skills).slice(0, options.maxSkills);
  const fields = [];
  if (wanted.length === 0) {
    return { fields: [field("skills", "Skills", F.UNVERIFIED, "The job lists no skills: choose at least one of Rozee's suggestions, then press Continue")], advance: "auto" };
  }
  for (const skill of wanted) {
    // Rozee suggests skills for the title: only a suggestion that is one of the job's own skills is chosen
    const chip = page.getByText(new RegExp(`^${escapeRegExp(skill)}$`, "i")).first();
    if (!(await isVisible(chip))) {
      fields.push(field(`skill:${norm(skill)}`, skill, F.SKIPPED, "Not one of Rozee's suggestions"));
      continue;
    }
    await human.click(page, chip);
    const menu = page.getByRole("menu");
    await menu.first().waitFor({ state: "visible", timeout: 2500 }).catch(() => {});
    const required = menu.getByText("Required", { exact: true }).first();
    if (await isVisible(required)) {
      await human.click(page, required);
      await human.settle();
      fields.push(field(`skill:${norm(skill)}`, skill, F.VERIFIED, "required"));
    } else {
      fields.push(field(`skill:${norm(skill)}`, skill, F.UNVERIFIED, "Choose Required for it yourself"));
    }
  }
  const chosen = fields.filter((f) => f.state === F.VERIFIED).length;
  if (chosen === 0) {
    return {
      fields: [...fields, field("skills", "Skills", F.UNVERIFIED, `None of Rozee's suggestions is one of this job's skills (${wanted.join(", ")}): choose the ones that fit, then press Continue`)],
      advance: "auto",
    };
  }
  const next = buttonNamed(page, "Continue");
  if ((await isVisible(next)) && (await next.isEnabled())) {
    await human.pause(300, 800);
    await human.click(page, next);
  }
  return { fields, advance: "auto" };
}

async function stepExperience(ctx) {
  const { page, human, values, options } = ctx;
  const years = String(minimumYears(values.experience, options.experienceYears));
  const typed = await typeInto(ctx, 'input[name="experience"]', years, { typos: false });
  const fields = [typed.ok ? field("experience", "Experience", F.VERIFIED, `${years} years`) : field("experience", "Experience", F.UNVERIFIED, `Enter ${years} yourself`)];
  if (typed.ok) await submitBox(page, human, typed.box);
  return { fields, advance: "auto" };
}

async function stepGender(ctx) {
  const { page, options } = ctx;
  const box = page.locator('input[name="gender_preference"]').first();
  if (!(await isVisible(box))) return { fields: [field("gender", "Gender preference", F.UNVERIFIED, `Choose "${options.genderPreference}" yourself`)], advance: "auto" };
  const picked = await chooseOption(ctx, box, new RegExp(`^${escapeRegExp(options.genderPreference)}$`, "i"));
  return { fields: [picked ? field("gender", "Gender preference", F.VERIFIED, options.genderPreference) : field("gender", "Gender preference", F.UNVERIFIED, `Choose "${options.genderPreference}" yourself`)], advance: "auto" };
}

async function stepManage(ctx) {
  const { page, human, options } = ctx;
  const typed = await typeInto(ctx, 'input[name="manageEmployees"]', options.manageEmployees, { typos: false });
  const fields = [typed.ok ? field("manage", "Manages others", F.VERIFIED, options.manageEmployees) : field("manage", "Manages others", F.UNVERIFIED, `Answer "${options.manageEmployees}" yourself`)];
  if (typed.ok) await submitBox(page, human, typed.box);
  return { fields, advance: "auto" };
}

async function stepOther(ctx) {
  const { page, human, options } = ctx;
  const typed = await typeInto(ctx, 'textarea[name="otherRequirements"]', options.otherRequirements, { typos: false });
  const fields = [typed.ok ? field("other", "Other requirements", F.VERIFIED) : field("other", "Other requirements", F.UNVERIFIED, "Type a line yourself")];
  const next = buttonNamed(page, "Continue");
  if (typed.ok && (await isVisible(next)) && (await next.isEnabled())) {
    await human.pause(300, 800);
    await human.click(page, next);
  }
  return { fields, advance: "auto" };
}

async function stepCity(ctx) {
  const { page, human, values } = ctx;
  const fields = [];
  const token = norm(values.location).split(/[\s,]+/)[0];
  const box = page.locator('input[name="cityId"]').first();
  if (!token) return { fields: [field("city", "City", F.UNVERIFIED, "The job has no location: choose a city")], advance: "auto" };
  if (!(await isVisible(box))) return { fields: [field("city", "City", F.UNVERIFIED, `Choose ${values.location} yourself`)], advance: "auto" };
  await human.fillIn(page, box, values.location.split(",")[0].trim(), { typos: true });
  // The list loads from the network: "Loading" first, then the cities
  const options = page.getByRole("option", { name: new RegExp(`${escapeRegExp(token)}.*pakistan|pakistan.*${escapeRegExp(token)}`, "i") });
  const listed = await options.first().waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false);
  if (listed) {
    await human.settle();
    await human.click(page, options.first());
    await human.settle();
  }
  const chip = page.locator(".MuiChip-root", { hasText: new RegExp(escapeRegExp(token), "i") }).first();
  fields.push((await isVisible(chip)) ? field("city", "City", F.VERIFIED, short(await readValue(chip))) : field("city", "City", F.UNVERIFIED, `Choose ${values.location} from the list yourself`));

  const wanted = workplaceChip(values.workplace);
  if (!values.workplace || !wanted) {
    fields.push(field("workplace", "Workplace", F.SKIPPED, "The job does not say where the work is done"));
  } else {
    const choice = page.getByText(wanted).first();
    if (await isVisible(choice)) {
      await human.click(page, choice);
      await human.settle();
      fields.push(field("workplace", "Workplace", F.VERIFIED, values.workplace));
    } else {
      fields.push(field("workplace", "Workplace", F.UNVERIFIED, `Choose ${values.workplace} yourself`));
    }
  }
  if (fields.every((f) => f.state !== F.UNVERIFIED)) {
    const next = buttonNamed(page, "Continue");
    if ((await isVisible(next)) && (await next.isEnabled())) {
      await human.pause(300, 800);
      await human.click(page, next);
    }
  }
  return { fields, advance: "auto" };
}

async function stepBudget(ctx) {
  const { page, human, values } = ctx;
  const max = digitsOf(values.salaryMax || values.salaryMin);
  const fields = [];
  let proceed = true;
  if (!max) {
    fields.push(field("budget", "Maximum monthly budget", F.SKIPPED, "The job has no pay: Rozee.pk shows none"));
  } else if (!isRupees(values.currency)) {
    fields.push(field("budget", "Maximum monthly budget", F.UNVERIFIED, `Rozee.pk's budget is in rupees per month and the job lists ${String(values.currency).toUpperCase()}: enter it yourself`));
    proceed = false;
  } else {
    const typed = await typeInto(ctx, 'input[name="maximumBudget"]', max, { typos: false });
    const ok = digitsOf(typed.found) === max;
    fields.push(ok ? field("budget", "Maximum monthly budget", F.VERIFIED, `PKR ${max}`) : field("budget", "Maximum monthly budget", F.UNVERIFIED, `Rozee.pk shows "${short(typed.found)}"`));
    proceed = ok;
  }
  if (proceed) {
    const next = buttonNamed(page, "Continue");
    if ((await isVisible(next)) && (await next.isEnabled())) {
      await human.pause(300, 800);
      await human.click(page, next);
    }
  }
  return { fields, advance: "auto" };
}

// The text under a heading of the job page ("Description:", "Responsibilities:"), up to the next heading. Reads the page's text
// in order, so it does not depend on how the sections are wrapped. A plain string, see page-tools.
const SECTION = (heading) => `(() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const next = /^[A-Z][A-Za-z ]{2,30}:$/;
  let started = false;
  const out = [];
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent.trim();
    if (!text) continue;
    if (!started) {
      started = text === ${JSON.stringify(heading + ":")} || text === ${JSON.stringify(heading)};
      continue;
    }
    if (next.test(text)) break;
    if (text === "Draft" || text === "Live" || text === "Published") continue;
    out.push(text);
  }
  return started ? out.join("\\n") : null;
})()`;

async function sectionText(page, heading) {
  try {
    return String((await page.evaluate(SECTION(heading))) ?? "");
  } catch {
    return "";
  }
}

const pageBody = async (page) => String(await page.evaluate("document.body ? document.body.innerText.slice(0, 40000) : ''").catch(() => ""));

// Rich-text boxes in Rozee.pk's page open when their text is clicked, and save by themselves when the click moves away
// The recruiter's own text can hold a line that reads like a heading ("Responsibilities:"), so the description's heading is the
// first one on the page and a later section's heading is the last.
const headingOf = (page, heading, which) => {
  const all = page.getByText(new RegExp(`^${escapeRegExp(heading)}:$`));
  return which === "last" ? all.last() : all.first();
};

async function openEditor(ctx, heading, which = "first") {
  const { page, human } = ctx;
  const title = headingOf(page, heading, which);
  if (!(await isVisible(title))) return null;
  const text = title.locator("xpath=following::p[normalize-space()][1]").first();
  const target = (await isVisible(text)) ? text : title.locator("xpath=following::div[normalize-space()][1]").first();
  if (!(await isVisible(target))) return null;
  await human.click(page, target);
  const editor = title.locator('xpath=following::*[@role="textbox" and @contenteditable="true"][1]').first();
  return (await editor.waitFor({ state: "visible", timeout: 3000 }).then(() => true, () => false)) ? editor : null;
}

async function leaveEditor(ctx, heading, which = "first") {
  const { page, human } = ctx;
  const title = headingOf(page, heading, which);
  if (await isVisible(title)) await human.click(page, title);
  await human.pause(900, 1500); // the draft saves itself
}

async function dismissPublishDialog({ page, human }) {
  const keep = page.getByText("Keep as draft", { exact: true }).first();
  if (!(await keep.waitFor({ state: "visible", timeout: 6000 }).then(() => true, () => false))) return null; // the dialog is not there
  await human.click(page, keep); // the safe answer: nothing is published, no credit is used
  await human.settle();
  return !(await isVisible(page.getByText("Post with free Featured Job credit").first()));
}

async function stepDraft(ctx) {
  const { page, human, values, options } = ctx;
  const fields = [];

  const closed = await dismissPublishDialog(ctx);
  if (closed === false) fields.push(field("dialog", "Publish dialog", F.UNVERIFIED, "Close the publish dialog without choosing a plan"));

  // Read the draft Rozee's AI wrote back: these came from the wizard's answers
  const body = String(await page.evaluate("document.body ? document.body.innerText.slice(0, 20000) : ''").catch(() => ""));
  const titleSeen = (await isVisible(page.getByText(values.title, { exact: true }).first())) || norm(body).includes(norm(values.title));
  fields.push(titleSeen ? field("title", "Job title", F.VERIFIED) : field("title", "Job title", F.UNVERIFIED, "The draft shows another title"));

  const max = digitsOf(values.salaryMax || values.salaryMin);
  if (max && isRupees(values.currency)) {
    const shown = numbersIn((body.match(/PKR\s*[\d,]+/i) || [""])[0]);
    fields.push(shown.includes(max) ? field("budget", "Pay", F.VERIFIED, `PKR ${max}`) : field("budget", "Pay", F.UNVERIFIED, `The draft shows "${short((body.match(/PKR\s*[\d,]+/i) || ["no pay"])[0])}"`));
  } else {
    fields.push(field("budget", "Pay", F.SKIPPED, max ? "Not in rupees: not entered" : "The job has no pay to compare"));
  }

  const token = norm(values.location).split(/[\s,]+/)[0];
  const place = (body.match(/([A-Za-z .'-]+,\s*Pakistan)\s*\(([A-Za-z-]+)\)/) || [])[0] || "";
  const wantedPlace = workplaceChip(values.workplace);
  const placeOk = place && (!token || norm(place).includes(token)) && (!wantedPlace || wantedPlace.test((place.match(/\(([^)]+)\)/) || [])[1] || ""));
  fields.push(token ? (placeOk ? field("location", "City and workplace", F.VERIFIED, short(place)) : field("location", "City and workplace", F.UNVERIFIED, `The draft shows "${short(place) || "none"}"`)) : field("location", "City and workplace", F.SKIPPED, "The job has no location"));

  const years = String(minimumYears(values.experience, options.experienceYears));
  const yearsSeen = (body.match(/Experience:?\s*(\d+)\s*Years?/i) || [])[1];
  fields.push(yearsSeen === years ? field("experience", "Experience", F.VERIFIED, `${years} years`) : field("experience", "Experience", F.UNVERIFIED, `The draft shows ${yearsSeen ? `${yearsSeen} years` : "none"}`));

  const wanted = skillList(values.skills).slice(0, options.maxSkills);
  const missing = wanted.filter((skill) => !norm(body).includes(norm(skill)));
  if (wanted.length) {
    fields.push(missing.length === wanted.length
      ? field("skills", "Skills", F.UNVERIFIED, `None of ${wanted.join(", ")} is on the draft: add them with the + next to Skills`)
      : field("skills", "Skills", F.VERIFIED, missing.length ? `${wanted.length - missing.length} of ${wanted.length} on the draft; add the rest with the + next to Skills` : undefined));
  }

  // Replace the AI's description with the recruiter's post
  if (!values.description) {
    fields.push(field("description", "Job description", F.UNVERIFIED, "The job has no description: write one"));
  } else {
    // What Rozee's AI wrote as Responsibilities, read before the recruiter's text is on the page (their text can look like headings)
    const aiResponsibilities = (await sectionText(page, "Responsibilities")).trim();
    const editor = await openEditor(ctx, "Description", "first");
    if (!editor) {
      fields.push(field("description", "Job description", F.UNVERIFIED, "Rozee.pk did not open the description for editing: replace Rozee's text with your post yourself"));
    } else {
      await page.keyboard.press("ControlOrMeta+A");
      await human.pause(150, 400);
      await human.typeText(page, values.description, { budgetMs: options.descriptionBudgetMs });
      await human.settle();
      const typed = await readValue(editor);
      await leaveEditor(ctx, "Description", "first");
      // The draft saves itself when the box is left: the page shows the start and the end of the post, and the box is closed
      const lines = values.description.split("\n").map((line) => line.trim()).filter(Boolean);
      const after = norm(await pageBody(page));
      const shown = after.includes(norm(lines[0])) && after.includes(norm(lines[lines.length - 1]));
      const closed = !(await isVisible(page.locator('[role="textbox"][contenteditable="true"]').first()));
      fields.push(closeEnough(values.description, typed) && shown && closed
        ? field("description", "Job description", F.VERIFIED)
        : field("description", "Job description", F.UNVERIFIED, "The saved text is not all of your post"));

      // The AI also wrote a Responsibilities section of its own, and the post already carries the responsibilities
      if (aiResponsibilities) {
        const list = await openEditor(ctx, "Responsibilities", "last");
        if (list) {
          await page.keyboard.press("ControlOrMeta+A");
          await page.keyboard.press("Backspace");
          await leaveEditor(ctx, "Responsibilities", "last");
        }
        const firstAi = aiResponsibilities.split("\n").map((line) => line.trim()).find(Boolean) || "";
        const gone = firstAi && !norm(await pageBody(page)).includes(norm(firstAi));
        fields.push(gone
          ? field("responsibilities", "Responsibilities (Rozee's own)", F.VERIFIED, "removed: the post carries them")
          : field("responsibilities", "Responsibilities (Rozee's own)", F.UNVERIFIED, "Rozee.pk's own Responsibilities text is still there: delete it or keep it"));
      }
    }
  }
  return { fields, advance: "confirm" };
}

const DRAFT_TEXT = /not published yet|draft mode/i;

export const ROZEE_FLOW = Object.freeze({
  platform: "rozee",
  label: "Rozee.pk",
  startUrl: ROZEE_START_URL,
  defaults: ROZEE_DEFAULTS,
  confirmLabel: "Publish Job",
  confirmNote: "it opens a dialog that applies one of your free Featured Job credits or sells an upgrade, and both are yours to choose",
  steps: [
    { id: "dashboard", label: "Open Post A New Job", match: /^\/employer\/dashboard\/?$/, run: openWizard },
    { id: "jobtitle", label: "Job title", match: /\/postjob\/jobtitle\/?$/, run: stepJobTitle },
    { id: "skills", label: "Skills", match: /\/postjob\/chooseskills\/?$/, run: stepSkills },
    { id: "experience", label: "Experience", match: /\/postjob\/experience\/?$/, run: stepExperience },
    { id: "gender", label: "Gender preference", match: /\/postjob\/genderpreference\/?$/, run: stepGender },
    { id: "manage", label: "Managing others", match: /\/postjob\/manageemployees\/?$/, run: stepManage },
    { id: "other", label: "Other requirements", match: /\/postjob\/otherrequirements\/?$/, run: stepOther },
    { id: "city", label: "City and workplace", match: /\/postjob\/cityid\/?$/, run: stepCity },
    // Rozee's AI writes the draft after this one: it can take a while
    { id: "budget", label: "Budget", match: /\/postjob\/maximumbudget\/?$/, run: stepBudget, waitMs: 90 * 1000 },
    { id: "draft", label: "Review the draft", match: /^\/employer\/job\/app\/\d+(\/|$)/, run: stepDraft },
  ],

  /** The step the page is on, or null for a page the flow does not know. */
  matchStep(url) {
    const path = pathOf(url);
    return this.steps.find((step) => step.match.test(path)) || null;
  },

  /** A verification check or a sign-in. null when the page is fine. */
  async blocker(page) {
    if (await pageShowsCheck(page)) {
      return { kind: GATE.CHECK, message: "Rozee.pk is showing a verification check. Complete it in the browser window; Raasta-AI never clicks it for you." };
    }
    let parsed;
    try {
      parsed = new URL(page.url());
    } catch {
      return null;
    }
    if (/(^|\.)(rozee\.pk|rozeegpt\.ai)$/.test(parsed.hostname) && /\/(login|signin|sign-in|signup|sign-up|register)(\/|$)/i.test(parsed.pathname)) {
      return { kind: GATE.SIGN_IN, message: "Rozee.pk is asking you to sign in. Sign in in the browser window; Raasta-AI never types your password. If Google refuses to sign in inside this window, use your Rozee.pk email and password." };
    }
    return null;
  },

  /** Rozee.pk keeps the draft on the same page when it goes live: the draft notice is what disappears. */
  async confirmCleared(page) {
    if (!/^\/employer\/job\/app\/\d+/.test(pathOf(page.url()))) return false;
    const body = String(await page.evaluate("document.body ? document.body.innerText.slice(0, 20000) : ''").catch(() => ""));
    return body.length > 200 && !DRAFT_TEXT.test(body);
  },

  /** How the run ends once the recruiter has published: the job's public link on Rozee.pk. */
  async finish(page) {
    const body = String(await page.evaluate("document.body ? document.body.innerText.slice(0, 20000) : ''").catch(() => ""));
    const link = (body.match(PUBLIC_LINK) || [])[0] || null;
    return { postUrl: link, message: `Rozee.pk has the job published${link ? "" : " (its public link was not shown on the page)"}. You chose how to publish it.` };
  },

  continueButton: (page) => page.getByRole("button", { name: "Continue", exact: true }).first(),
});

