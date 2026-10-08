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
export const READ_VALUE = new Function("el", "return (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ? el.value : (el.innerText || el.textContent || ''))");

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

/**
 * Opens a custom drop-down and picks the option whose text matches `matcher` (a RegExp). Returns true when an option
 * was clicked. Closes the list again when nothing matched, so the page is left as it was found.
 */
export async function chooseOption({ page, human }, trigger, matcher) {
  await human.click(page, trigger);
  const options = page.getByRole("option", { name: matcher });
  const items = page.getByRole("menuitem", { name: matcher });
  const found = (await options.first().waitFor({ state: "visible", timeout: 2500 }).then(() => options, () => null))
    || (await items.first().waitFor({ state: "visible", timeout: 800 }).then(() => items, () => null));
  if (!found) {
    await page.keyboard.press("Escape").catch(() => {});
    return false;
  }
  await human.settle();
  await human.click(page, found.first());
  await human.settle();
  return true;
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
