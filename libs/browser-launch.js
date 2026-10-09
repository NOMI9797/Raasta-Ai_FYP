// How Raasta-AI opens a Chrome window for Indeed: the posting engine (libs/poster/engine.js), the sign-in window of "Add Indeed
// Account" (libs/indeed-connect.js) and Diagnose (libs/indeed-session-validator.js) all use this, so none of them announces
// itself as automated. Relative imports only (it also runs outside Next.js).
//
// Playwright starts Chrome with --enable-automation, which sets navigator.webdriver to true on every page and shows the
// "controlled by automated test software" bar. Seen on 2026-10-08, with the same Chrome and address, in new profiles:
// Cloudflare challenge pages (ScrapingCourse's, NopeCHA's) stayed on "Just a moment..." with the flag and passed by
// themselves without it (docs/ai-hiring/19, section 5f). Dropping the flag is the only measure taken: no fingerprint or
// user-agent changes, and the window is still visible with a person in it.

/** Whether Chrome's automation flag is hidden. On unless POSTER_STEALTH is false (or off, 0, no). */
export const hidesAutomationFlag = (env = process.env) => !["false", "off", "0", "no"].includes(String(env.POSTER_STEALTH ?? "").trim().toLowerCase());

// Chrome shows a bar across the top of the window for flags it does not support, and --disable-blink-features is one of them (the owner saw
// "You are using an unsupported command-line flag: --disable-blink-features=AutomationControlled" and had to close it by hand). Measured on
// 2026-10-08 as the gap between the window's outer and inner height: 142 px with the flag, 86 px with --test-type added, which also keeps
// navigator.webdriver false. Dropping --enable-automation alone gives no bar but leaves navigator.webdriver true.
/** The Playwright launch options that hide the flag: { args, ignoreDefaultArgs? }, to be merged into a window's own. */
export function automationLaunchOptions(env = process.env) {
  return hidesAutomationFlag(env)
    ? { args: ["--disable-blink-features=AutomationControlled", "--test-type"], ignoreDefaultArgs: ["--enable-automation"] }
    : { args: [] };
}

/**
 * Open a visible window with Chrome's own sandbox on. Playwright starts Chrome without it (--no-sandbox), and Chrome then shows a
 * bar across the top of the window: "You are using an unsupported command-line flag: --no-sandbox. Stability and security will suffer."
 * `open({ chromiumSandbox })` starts the browser. If this machine's Chrome will not start with the sandbox, it is started without.
 */
export async function withSandbox(open) {
  try {
    return await open({ chromiumSandbox: true });
  } catch (error) {
    if (!/sandbox/i.test(String(error?.message))) throw error;
    return open({ chromiumSandbox: false });
  }
}

/** The browsers to try, in order: the one the person already has (POSTER_BROWSER: chrome by default, msedge, or chromium), then the one Playwright installs (null). */
export function browserChannels(env = process.env) {
  const wanted = String(env.POSTER_BROWSER || "chrome").trim().toLowerCase();
  return wanted === "chromium" ? [null] : [wanted, null];
}

/**
 * Open a browser the first way that works. `open(channel)` starts it (channel is null for Playwright's own Chromium).
 * Returns { value, browser } where browser names what was opened; throws the last error when none could be.
 */
export async function openWithFallback(open, env = process.env) {
  let lastError;
  for (const channel of browserChannels(env)) {
    try {
      return { value: await open(channel), browser: channel || "chromium" };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
