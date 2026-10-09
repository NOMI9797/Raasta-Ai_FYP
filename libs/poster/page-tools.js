// Small helpers the posting flows share: reading what is on a page, comparing it with what was meant to be typed,
// picking from a custom drop-down, and waiting for the page to move on. Page scripts are plain strings, not functions:
// functions passed to Playwright under tsx get helper calls added that do not exist in the page ("__name is not defined").
// Relative imports only (also used by the engine process).

/** Lower case, accents kept, whitespace collapsed: the form in which two texts are compared. */
export const norm = (text) => String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** A text with punctuation and bullets dropped as well, for comparing a typed description with what the editor shows. */
export const squash = (text) => norm(String(text ?? "").replace(/^[\s>*•-]+/gm, "").replace(/[^\p{L}\p{N}\s]/gu, " "));

export const escapeRegExp = (text) => String(text ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The digits of a number as written on a page: "Rs33,000.00" is "33000". A figure with decimals loses them. */
export function digitsOf(text) {
  const match = String(text ?? "").replace(/,/g, "").match(/\d+(\.\d+)?/);
  return match ? String(Math.trunc(Number(match[0]))) : "";
}

/** Every whole number in a text ("Rs33,000.00 - Rs200,000.00 per month" gives 33000 and 200000). */
export function numbersIn(text) {
  return (String(text ?? "").replace(/,/g, "").match(/\d+(\.\d+)?/g) || []).map((n) => String(Math.trunc(Number(n))));
}

// Built with new Function, not written as an arrow function: a function written here would get helper calls added by the
// build step that the page does not have, and a plain string is evaluated as an expression, not called.
export const READ_VALUE = new Function("el", "if (el.tagName === 'SELECT') return (el.selectedOptions && el.selectedOptions[0]) ? el.selectedOptions[0].text : el.value; return (/^(INPUT|TEXTAREA)$/.test(el.tagName) ? el.value : (el.innerText || el.textContent || ''))");

/** The text a box holds, or what a drop-down or button shows. Empty when the element is not there. */
export async function readValue(locator) {
  try {
    if ((await locator.count()) === 0) return "";
    return String(await locator.first().evaluate(READ_VALUE)).trim();
  } catch {
    return "";
  }
}

export async function isVisible(locator) {
  try {
    return (await locator.count()) > 0 && (await locator.first().isVisible());
  } catch {
    return false;
  }
}

// What a form shows when it will not move on: an open dialog, or an alert or error message. Plain string, see the file note.
const VISIBLE_PROBLEM = `(() => {
  const shown = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const pick = (selector) => Array.from(document.querySelectorAll(selector)).filter(shown).map((el) => (el.innerText || "").replace(/\\s+/g, " ").trim()).filter(Boolean);
  const dialog = pick('[role="dialog"], [role="alertdialog"], dialog[open]');
  if (dialog.length) return { kind: "dialog", text: dialog[0].slice(0, 220) };
  const alerts = pick('[role="alert"], [aria-live="assertive"], [id*="error" i], [class*="error" i]');
  if (alerts.length) return { kind: "message", text: alerts[0].slice(0, 220) };
  return null;
})()`;

/** { kind: "dialog" | "message", text } for what is in the way on the page, or null. */
export async function visibleProblem(page) {
  try {
    return await page.evaluate(VISIBLE_PROBLEM);
  } catch {
    return null;
  }
}

/** Waits for an element to be on the page and visible. Returns true when it is, false when the time runs out. Never throws. */
export async function waitVisible(locator, timeoutMs = 8000) {
  try {
    await locator.first().waitFor({ state: "visible", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/**
 * Picks the option whose text matches `matcher` (a RegExp) from a custom drop-down. Returns true when an option was clicked.
 * Some drop-downs open by themselves when their question appears, and clicking the box then closes them: so the list is looked
 * for first, the box is clicked only if it is not showing, then the box's own "Open" button, and the list is closed again
 * when nothing matched, so the page is left as it was found.
 */
export async function chooseOption({ page, human }, trigger, matcher) {
  const options = page.getByRole("option", { name: matcher });
  const items = page.getByRole("menuitem", { name: matcher });
  const shown = async (ms) => ((await waitVisible(options, ms)) ? options : (await waitVisible(items, Math.min(ms, 800))) ? items : null);

  let found = await shown(500);
  if (!found) {
    await human.click(page, trigger);
    found = await shown(2500);
  }
  if (!found) {
    const open = page.getByRole("button", { name: /^open$/i }).first();
    if (await isVisible(open)) {
      await human.click(page, open);
      found = await shown(2500);
    }
  }
  if (!found) {
    await page.keyboard.press("Escape").catch(() => {});
    return false;
  }
  await human.settle();
  await human.click(page, found.first());
  await human.settle();
  return true;
}

// Finds the control a label belongs to, whatever the page calls it: a <label for>, an aria-label or aria-labelledby, or the first
// control after the label's text inside the same block. Marks it with data-raasta-control so it can be addressed, and says what it is.
// A plain string, see the file note.
const LABELLED_CONTROL = (source) => `(() => {
  const re = new RegExp(${JSON.stringify(source)}, "i");
  const shown = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  document.querySelectorAll("[data-raasta-control]").forEach((el) => el.removeAttribute("data-raasta-control"));
  const CONTROL = 'select, [role="combobox"], [role="listbox"], [aria-haspopup="listbox"], button[aria-haspopup], [data-testid*="selector" i], input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])';
  let target = null;
  for (const label of document.querySelectorAll("label")) {
    if (!re.test((label.innerText || "").trim())) continue;
    const id = label.getAttribute("for");
    const el = id ? document.getElementById(id) : label.querySelector(CONTROL);
    if (el && shown(el)) { target = el; break; }
  }
  if (!target) {
    for (const el of document.querySelectorAll(CONTROL)) {
      if (!shown(el)) continue;
      const ids = el.getAttribute("aria-labelledby");
      const name = el.getAttribute("aria-label") || (ids ? ids.split(" ").map((id) => (document.getElementById(id) || {}).innerText || "").join(" ") : "");
      if (re.test(name)) { target = el; break; }
    }
  }
  if (!target) {
    const texts = Array.from(document.querySelectorAll("label, legend, p, span, div, h2, h3, h4")).filter((el) => { const t = (el.innerText || "").trim(); return t.length < 60 && re.test(t) && el.children.length <= 2 && shown(el); });
    for (const text of texts) {
      let box = text;
      for (let up = 0; up < 5 && box && !target; up += 1) {
        box = box.parentElement;
        if (!box) break;
        target = Array.from(box.querySelectorAll(CONTROL)).find((el) => shown(el) && (text.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) || null;
      }
      if (target) break;
    }
  }
  if (!target) return null;
  target.setAttribute("data-raasta-control", "1");
  return { tag: target.tagName.toLowerCase(), role: target.getAttribute("role"), testid: target.getAttribute("data-testid") };
})()`;

/**
 * The control a visible label belongs to, found by the label's words rather than by an id that may change: { locator, info } or null.
 * `labelSource` is the source of a case-insensitive regular expression, e.g. "^job location type".
 */
export async function labelledControl(page, labelSource) {
  try {
    const info = await page.evaluate(LABELLED_CONTROL(labelSource));
    return info ? { locator: page.locator('[data-raasta-control="1"]').first(), info } : null;
  } catch {
    return null;
  }
}

/**
 * Sets a drop-down to the option whose text matches `matcher`: a real <select> through its options, a custom list by opening
 * it and clicking the option (chooseOption). Returns true when an option was chosen.
 */
export async function pickFromControl(ctx, control, matcher) {
  const isSelect = await control.evaluate(new Function("el", "return el.tagName === 'SELECT'")).catch(() => false);
  if (isSelect) {
    const texts = await control.evaluate(new Function("el", "return Array.from(el.options).map((o) => o.text)")).catch(() => []);
    const index = texts.findIndex((text) => matcher.test(text));
    if (index === -1) return false;
    await ctx.human.click(ctx.page, control).catch(() => {});
    await control.selectOption({ index });
    await ctx.human.settle();
    return true;
  }
  return chooseOption(ctx, control, matcher);
}

/** Waits for the page's path to differ from `fromPath`. Returns the new path, or null when it did not change in time. */
export async function waitForPathChange(page, fromPath, { timeoutMs = 10000, pollMs = 250, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const path = pathOf(page.url());
    if (path !== fromPath) return path;
    await sleep(pollMs);
  }
  return null;
}

export function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}
