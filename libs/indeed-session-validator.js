/**
 * Indeed Session Validator
 *
 * Hydrates a Playwright context from stored Indeed session data and verifies the session is still signed in to the
 * employer area. Indeed sometimes answers a replayed session with a verification page instead of the dashboard;
 * that is reported as a challenge (a person has to confirm it), never worked around.
 */

import os from "node:os";
import path from "node:path";
import { automationLaunchOptions, openWithFallback, withSandbox } from "./browser-launch";
import { DEFAULT_BROWSER_ARGS, restoreSessionToContext } from "./playwright-utils";

export const INDEED_EMPLOYER_URL = "https://employers.indeed.com/";

const SIGN_IN_HOST = "secure.indeed.com";
const EMPLOYER_HOST = "employers.indeed.com";

// Text a verification (bot check) page shows in its title
const CHALLENGE_TITLE = /just a moment|additional verification|verify you are (a )?human|security check|attention required|captcha/i;

/**
 * Where a URL puts the browser:
 *   signed_in - the employer area
 *   login     - Indeed's sign-in page (the session is missing, expired or revoked)
 *   challenge - a verification page
 *   other     - anything else
 */
export function classifyIndeedUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "other";
  }
  const { hostname, pathname } = parsed;
  if (pathname.startsWith("/cdn-cgi/") || /captcha|challenge/i.test(pathname)) return "challenge";
  if (hostname === SIGN_IN_HOST || pathname.startsWith("/auth") || pathname.startsWith("/account/login")) return "login";
  if (hostname === EMPLOYER_HOST) return "signed_in";
  return "other";
}

export function looksLikeChallenge(title) {
  return CHALLENGE_TITLE.test(String(title || ""));
}

// Words a verification page shows in its body (Indeed's own wrapper around Cloudflare's check, and Cloudflare's)
const CHALLENGE_TEXT = /additional verification required|verify you are (a )?human|checking (if|your) browser|your ray id for this request/i;

/**
 * Whether the page in front of the browser is a verification check. The title alone is not enough: the title can be
 * empty or stale while a page changes, so this also reads the page's own words and looks for the check's frame.
 * A page that cannot be read (it is navigating) counts as still showing a check; the caller asks again.
 */
export async function pageShowsCheck(page) {
  if (classifyIndeedUrl(page.url()) === "challenge") return true;
  if (page.frames().some((frame) => /challenges.cloudflare.com/.test(frame.url()))) return true;
  try {
    if (looksLikeChallenge(await page.title())) return true;
    const text = await page.evaluate(() => (document.body ? document.body.innerText.slice(0, 1500) : ""));
    return CHALLENGE_TEXT.test(text);
  } catch {
    return true;
  }
}

/**
 * With the window shown, a person can clear a verification check themselves. This waits for that and only watches:
 * it never touches the page or the check. Returns { cleared, where }; cleared is false when the time ran out or the
 * window was closed.
 */
export async function waitForCheckToClear(page, { timeoutMs, pollMs = 2000, stablePolls = 2 }) {
  const deadline = Date.now() + timeoutMs;
  let where = classifyIndeedUrl(page.url());
  let clear = 0;
  try {
    while (Date.now() < deadline) {
      await page.waitForTimeout(pollMs);
      where = classifyIndeedUrl(page.url());
      // Cleared only once the page has stopped looking like a check for several polls in a row, not for a flicker
      clear = (await pageShowsCheck(page)) ? 0 : clear + 1;
      if (clear >= stablePolls) return { cleared: true, where };
    }
  } catch {
    // the window was closed while waiting
  }
  return { cleared: false, where };
}

/**
 * Open the browser Diagnose and the session test use: the person's own Chrome (Playwright's Chromium when there is none), not
 * announcing itself as automated, because Cloudflare's check keeps coming back to a window that does (libs/browser-launch.js).
 * `visible` shows the window. The profile folder is for Chrome only: a profile made by another browser is not reused. Exported for the tests.
 */
export async function openIndeedContext({ playwright, profileId, visible = false, env = process.env }) {
  const hide = automationLaunchOptions(env);
  const dir = path.join(os.tmpdir(), `indeed-test-chrome-${profileId}`);
  const options = visible
    ? { headless: false, viewport: null, slowMo: 300, ...hide }
    : { headless: true, viewport: { width: 1280, height: 800 }, ...hide, args: [...DEFAULT_BROWSER_ARGS, ...hide.args] };
  // A window the person watches has Chrome's sandbox on (no "--no-sandbox" warning bar); a hidden one keeps Playwright's default, which a server needs
  const open = (sandbox, channel) => playwright.chromium.launchPersistentContext(dir, { ...options, ...sandbox, ...(channel ? { channel } : {}) });
  return openWithFallback((channel) => (visible ? withSandbox((sandbox) => open(sandbox, channel)) : open({}, channel)), env);
}

/**
 * Open the employer area with a saved session and say whether it is signed in.
 * Options: `recorder` (libs/indeed-debug.js) records what the page looked like; `visible` shows the browser window
 * (only where the server has a screen) so a person can watch; `waitForCheckMs`, with the window shown, waits that
 * long for the person to clear a verification check themselves instead of stopping at once.
 */
export async function testIndeedSession(sessionData, keepOpen = false, { recorder = null, visible = false, waitForCheckMs = 0 } = {}) {
  console.log("Testing Indeed session validity...");

  try {
    const playwright = await import("playwright");
    const { value: context } = await openIndeedContext({ playwright, profileId: sessionData.sessionId || Date.now(), visible });

    const page = context.pages()[0] || (await context.newPage());
    recorder?.attach(page);

    try {
      await restoreSessionToContext(context, page, sessionData);

      await page.goto(INDEED_EMPLOYER_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000);

      let currentUrl = page.url();
      let where = classifyIndeedUrl(currentUrl);
      let challenged = await pageShowsCheck(page);
      await recorder?.snap(page, "employer-home", { note: challenged ? "verification page" : where, inline: true });

      if (challenged && visible && waitForCheckMs > 0) {
        recorder?.note("waiting-for-you", `Indeed shows a verification check. Waiting up to ${Math.round(waitForCheckMs / 1000)} seconds for you to clear it in the window; nothing is clicked for you`);
        const outcome = await waitForCheckToClear(page, { timeoutMs: waitForCheckMs });
        if (outcome.cleared) {
          await page.waitForTimeout(3000); // let the page the check was guarding load
          currentUrl = page.url();
          where = classifyIndeedUrl(currentUrl);
          challenged = false;
        }
        await recorder?.snap(page, outcome.cleared ? "check-cleared" : "check-not-cleared", { note: outcome.cleared ? where : "the check was still showing", inline: true });
      }

      if (challenged) {
        await context.close();
        return { isValid: false, challenge: true, reason: "Indeed is asking for a verification check", currentUrl };
      }
      if (where === "login") {
        await context.close();
        return { isValid: false, reason: "Session expired — redirected to Indeed sign-in", currentUrl };
      }
      if (where === "signed_in") {
        if (keepOpen) {
          return { isValid: true, reason: "Successfully accessed the Indeed employer area", currentUrl, context, page };
        }
        await context.close();
        return { isValid: true, reason: "Successfully accessed the Indeed employer area", currentUrl };
      }

      await context.close();
      return { isValid: false, reason: "Unexpected page after navigation", currentUrl };
    } catch (error) {
      recorder?.note("session-error", String(error.message).split("\n")[0]);
      await context.close();
      return { isValid: false, reason: `Error testing Indeed session: ${error.message}`, currentUrl: null };
    }
  } catch (error) {
    return { isValid: false, reason: `Browser launch failed: ${error.message}`, currentUrl: null };
  }
}

export async function validateAndKeepOpen(accountData) {
  return await testIndeedSession(accountData, true);
}

export async function cleanupBrowserSession(context) {
  try {
    if (context) await context.close();
  } catch (err) {
    console.error("Failed to close Indeed browser session:", err.message);
  }
}
