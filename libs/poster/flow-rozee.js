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
import { chooseOption, digitsOf, escapeRegExp, isVisible, norm, numbersIn, pathOf, readValue, waitForPathChange, waitVisible } from "./page-tools";
import { closeEnough } from "./flow-indeed";
import { pickSkills, rankSuggestions } from "./skill-match";

export const ROZEE_START_URL = "https://www.rozeegpt.ai/employer/dashboard";

// What a run uses when it is not told otherwise. The kit has no counterpart for these questions.
export const ROZEE_DEFAULTS = Object.freeze({
  genderPreference: "No Preference", // never narrowed: the wizard asks, the job does not say
  manageEmployees: "No",
  otherRequirements: "No other requirements.",
  experienceYears: 1, // when the job gives no experience range
  minSkills: 3, // the wizard will not go on without a skill: when the job's own skills match nothing, the closest suggestions are chosen
  maxSkills: 6,
  currency: "PKR",
  boxWaitMs: 8000, // a page of the wizard is a React app: its boxes appear a moment after the address changes
  dashboardWaitMs: 40 * 1000, // the dashboard shows a splash screen before its buttons
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
  const { page, human, options } = ctx;
  const box = page.locator(selector).first();
  if (!(await waitVisible(box, options.boxWaitMs))) return { box, ok: false, found: "" };
  await human.fillIn(page, box, value, { typos });
  await human.settle();
  const found = await readValue(box);
  return { box, ok: norm(found) === norm(value), found };
}

// Presses Continue when it is there and on. Returns whether it was pressed.
async function pressContinue({ page, human }) {
  const next = buttonNamed(page, "Continue");
  if (!(await waitVisible(next, 3000)) || !(await next.isEnabled())) return false;
  await human.pause(300, 800);
  await human.click(page, next);
  return true;
}

// ── Steps ──

// The dashboard shows a splash screen first (the page is black with the logo): the button is waited for, not given up on
async function openWizard({ page, human, sleep, options }) {
  const button = page.getByRole("button", { name: /^post a new job$/i }).filter({ visible: true }).first();
  const alternative = page.getByText(/^post a new job$/i).filter({ visible: true }).first();
  const ready = (await waitVisible(button, options.dashboardWaitMs)) || (await waitVisible(alternative, 2000));
  if (!ready) {
    return { fields: [field("open", "Open Post A New Job", F.UNVERIFIED, 'The dashboard did not show "Post A New Job": click it yourself')], advance: "auto" };
  }
  const from = pathOf(page.url());
  await human.glance(page);
  await human.click(page, (await isVisible(button)) ? button : alternative);
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

// The suggested skill chips, in the order Rozee shows them: the texts between the sentence that asks to select the relevant ones
// and the Add New Skill button. A plain string, see page-tools.
const SUGGESTED_SKILLS = `(() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const stop = /^(required|nice to have|add new skill|continue)$/i;
  let started = false;
  const out = [];
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent.trim();
    if (!text) continue;
    if (!started) { started = /select the relevant/i.test(text); continue; }
    if (stop.test(text)) break;
    const el = walker.currentNode.parentElement;
    const box = el ? el.getBoundingClientRect() : null;
    if (box && box.width > 0 && box.height > 0 && text.length <= 60 && out.indexOf(text) === -1) out.push(text);
  }
  return out;
})()`;

async function readSuggestions(page) {
  try {
    const found = await page.evaluate(SUGGESTED_SKILLS);
    return Array.isArray(found) ? found.map(String) : [];
  } catch {
    return [];
  }
}

// Choose one suggested skill: click its chip, then Required or Nice to Have in the small menu that opens
async function chooseSkill(ctx, pick) {
  const { page, human } = ctx;
  const key = `skill:${norm(pick.text)}`;
  const note = (level, why) => `${level.toLowerCase()}${why ? ` (closest to ${why})` : ""}`;
  const chip = page.getByText(new RegExp(`^${escapeRegExp(pick.text)}$`, "i")).first();
  if (!(await isVisible(chip))) return field(key, pick.text, F.SKIPPED, "No longer on the page");
  await human.click(page, chip);
  const menu = page.getByRole("menu");
  await menu.first().waitFor({ state: "visible", timeout: 2500 }).catch(() => {});
  const level = menu.getByText(pick.level, { exact: true }).first();
  if (!(await isVisible(level))) return field(key, pick.text, F.UNVERIFIED, `Choose ${pick.level} for it yourself`);
  await human.click(page, level);
  await human.settle();
  return field(key, pick.text, F.VERIFIED, note(pick.level, pick.reason));
}

// Skills: the job's own skills are in the recruiter's words and Rozee's suggestions are in its own, so the closest suggestions are
// chosen (libs/poster/skill-match.js): those near the job's skills as Required, and when there are none (the job lists no skills, or
// nothing matches) the best few for the job title as Nice to Have. Rozee may show more suggestions once some are chosen, so this
// looks again and chooses more, up to the limit.
async function stepSkills(ctx) {
  const { page, human, values, options, sleep } = ctx;
  const profile = { skills: skillList(values.skills), title: values.title, description: values.description };
  const fields = [];
  const chosen = [];
  ctx.memo.skills = chosen;

  await waitVisible(page.getByText(/select the relevant/i), options.boxWaitMs);
  for (let round = 0; round < 4 && chosen.length < options.maxSkills; round += 1) {
    const more = page.getByRole("button", { name: /^(load|show|see) more( skills)?$/i }).first();
    if (round === 0 && (await isVisible(more))) {
      await human.click(page, more);
      await human.settle();
    }
    const suggestions = (await readSuggestions(page)).filter((text) => !chosen.some((name) => norm(name) === norm(text)));
    if (suggestions.length === 0) break;
    const picks = pickSkills(rankSuggestions({ suggestions, ...profile }), { chosen: chosen.length, max: options.maxSkills, min: options.minSkills });
    if (picks.length === 0) break;
    let added = 0;
    for (const pick of picks) {
      const done = await chooseSkill(ctx, pick);
      fields.push(done);
      if (done.state === F.VERIFIED) {
        chosen.push(pick.text);
        added += 1;
      }
    }
    if (added === 0) break;
    await sleep(900); // more suggestions can appear once some are chosen
    await human.settle();
  }

  if (chosen.length === 0) {
    const none = readSuggestionsNote(fields);
    return { fields: [...fields, field("skills", "Skills", F.UNVERIFIED, `No skill could be chosen${none}: choose the ones that fit, then press Continue`)], advance: "auto" };
  }
  await pressContinue(ctx);
  return { fields, advance: "auto" };
}

const readSuggestionsNote = (fields) => (fields.length ? ` (${fields.map((f) => `${f.label}: ${f.note}`).slice(0, 2).join("; ")})` : " (Rozee.pk showed none)");

async function stepExperience(ctx) {
  const { page, human, values, options } = ctx;
  const years = String(minimumYears(values.experience, options.experienceYears));
  const typed = await typeInto(ctx, 'input[name="experience"]', years, { typos: false });
  const fields = [typed.ok ? field("experience", "Experience", F.VERIFIED, `${years} years`) : field("experience", "Experience", F.UNVERIFIED, `Enter ${years} yourself`)];
  if (typed.ok) await submitBox(page, human, typed.box);
  return { fields, advance: "auto" };
}

// Gender preference: a drop-down that is usually already open when the question appears, so clicking the box would close it.
// The option is chosen from the list; if the list cannot be used, the box is typed into and the first match taken.
async function stepGender(ctx) {
  const { page, human, options, sleep } = ctx;
  const wanted = options.genderPreference;
  const failed = { fields: [field("gender", "Gender preference", F.UNVERIFIED, `Choose "${wanted}" yourself`)], advance: "auto" };
  const box = page.locator('input[name="gender_preference"]').first();
  if (!(await waitVisible(box, options.boxWaitMs))) return failed;
  const from = pathOf(page.url());
  if (await chooseOption(ctx, box, new RegExp(`^${escapeRegExp(wanted)}$`, "i"))) {
    return { fields: [field("gender", "Gender preference", F.VERIFIED, wanted)], advance: "auto" };
  }
  // Typing to filter the list, then the keyboard
  await human.fillIn(page, box, wanted.slice(0, 5), { typos: false });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const moved = await waitForPathChange(page, from, { timeoutMs: 4000, sleep });
  return moved ? { fields: [field("gender", "Gender preference", F.VERIFIED, `${wanted} (by keyboard)`)], advance: "auto" } : failed;
}

async function stepManage(ctx) {
  const { page, human, options } = ctx;
  const typed = await typeInto(ctx, 'input[name="manageEmployees"]', options.manageEmployees, { typos: false });
  const fields = [typed.ok ? field("manage", "Manages others", F.VERIFIED, options.manageEmployees) : field("manage", "Manages others", F.UNVERIFIED, `Answer "${options.manageEmployees}" yourself`)];
  if (typed.ok) await submitBox(page, human, typed.box);
  return { fields, advance: "auto" };
}

async function stepOther(ctx) {
  const { options } = ctx;
  const typed = await typeInto(ctx, 'textarea[name="otherRequirements"]', options.otherRequirements, { typos: false });
  const fields = [typed.ok ? field("other", "Other requirements", F.VERIFIED) : field("other", "Other requirements", F.UNVERIFIED, "Type a line yourself")];
  if (typed.ok) await pressContinue(ctx);
  return { fields, advance: "auto" };
}

async function stepCity(ctx) {
  const { page, human, values, options } = ctx;
  const fields = [];
  const token = norm(values.location).split(/[\s,]+/)[0];
  const box = page.locator('input[name="cityId"]').first();
  if (!token) return { fields: [field("city", "City", F.UNVERIFIED, "The job has no location: choose a city")], advance: "auto" };
  if (!(await waitVisible(box, options.boxWaitMs))) return { fields: [field("city", "City", F.UNVERIFIED, `Choose ${values.location} yourself`)], advance: "auto" };
  await human.fillIn(page, box, values.location.split(",")[0].trim(), { typos: true });
  // The list loads from the network: "Loading" first, then the cities
  const cities = page.getByRole("option", { name: new RegExp(`${escapeRegExp(token)}.*pakistan|pakistan.*${escapeRegExp(token)}`, "i") });
  if (await waitVisible(cities, 8000)) {
    await human.settle();
    await human.click(page, cities.first());
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
  if (fields.every((f) => f.state !== F.UNVERIFIED)) await pressContinue(ctx);
  return { fields, advance: "auto" };
}

async function stepBudget(ctx) {
  const { values } = ctx;
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
  if (proceed) await pressContinue(ctx);
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

// The recruiter's own text can hold a line that reads like a heading ("Responsibilities:"), so the description's heading is the
// first one on the page and a later section's heading is the last. The heading may sit next to a "Draft" badge in the same element.
const headingOf = (page, heading, which) => {
  const all = page.getByText(new RegExp(`^${escapeRegExp(heading)}:\\s*(draft|live|published)?$`, "i"));
  return which === "last" ? all.last() : all.first();
};

const EDITOR = '[role="textbox"][contenteditable="true"]';

// Rich-text boxes in Rozee.pk's page open when their text is clicked, and save by themselves when the click moves away. Only one
// section is open at a time, so the box that appears after the click is the section's. Returns { editor } or { stage }, where stage
// says how far it got, so a failure on the real page says where.
async function openEditor(ctx, heading, which = "first") {
  const { page, human, options } = ctx;
  const title = headingOf(page, heading, which);
  if (!(await waitVisible(title, options.boxWaitMs))) return { editor: null, stage: "its heading was not found" };
  const targets = [
    title.locator("xpath=following::p[normalize-space()][1]").first(),
    title.locator("xpath=following::li[normalize-space()][1]").first(),
    title.locator("xpath=following::div[normalize-space()][1]").first(),
  ];
  let clicked = false;
  for (const target of targets) {
    if (!(await isVisible(target))) continue;
    clicked = true;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await human.click(page, target); // a second click is what a person would try
      const editor = page.locator(EDITOR).first();
      if (await waitVisible(editor, 2500)) return { editor, stage: null };
    }
  }
  return { editor: null, stage: clicked ? "no text box opened when its text was clicked" : "there was no text under its heading to click" };
}

async function leaveEditor(ctx, heading, which = "first") {
  const { page, human } = ctx;
  const title = headingOf(page, heading, which);
  if (await isVisible(title)) await human.click(page, title);
  await human.pause(900, 1500); // the draft saves itself
}

async function dismissPublishDialog({ page, human }) {
  const keep = page.getByText("Keep as draft", { exact: true }).first();
  if (!(await waitVisible(keep, 6000))) return null; // the dialog is not there
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

  // The skills the wizard step chose (the closest suggestions), or the job's own when that step did not run
  const wanted = ctx.memo.skills?.length ? ctx.memo.skills : skillList(values.skills).slice(0, options.maxSkills);
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
    // What Rozee's AI wrote, read before the recruiter's text is on the page (their text can look like headings)
    const aiResponsibilities = (await sectionText(page, "Responsibilities")).trim();
    const aiDescription = (await sectionText(page, "Description")).trim();
    const { editor, stage } = await openEditor(ctx, "Description", "first");
    const aiStart = norm(aiDescription).slice(0, 30);
    const openedRight = editor && (!aiStart || norm(await readValue(editor)).startsWith(aiStart.slice(0, 20)));
    if (!editor) {
      fields.push(field("description", "Job description", F.UNVERIFIED, `Rozee.pk did not open the description for editing (${stage}): replace Rozee's text with your post yourself`));
    } else if (!openedRight) {
      fields.push(field("description", "Job description", F.UNVERIFIED, "The box that opened is not the description: replace Rozee's text with your post yourself"));
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
      const stillOpen = await isVisible(page.locator(EDITOR).first());
      fields.push(closeEnough(values.description, typed) && shown && !stillOpen
        ? field("description", "Job description", F.VERIFIED)
        : field("description", "Job description", F.UNVERIFIED, "The saved text is not all of your post"));

      // The AI also wrote a Responsibilities section of its own, and the post already carries the responsibilities
      if (aiResponsibilities) {
        const list = await openEditor(ctx, "Responsibilities", "last");
        if (list.editor) {
          await page.keyboard.press("ControlOrMeta+A");
          await page.keyboard.press("Backspace");
          await leaveEditor(ctx, "Responsibilities", "last");
        }
        const firstAi = aiResponsibilities.split("\n").map((line) => line.trim()).find(Boolean) || "";
        const gone = firstAi && !norm(await pageBody(page)).includes(norm(firstAi));
        fields.push(gone
          ? field("responsibilities", "Responsibilities (Rozee's own)", F.VERIFIED, "removed: the post carries them")
          : field("responsibilities", "Responsibilities (Rozee's own)", F.UNVERIFIED, `Rozee.pk's own Responsibilities text is still there${list.stage ? ` (${list.stage})` : ""}: delete it or keep it`));
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
