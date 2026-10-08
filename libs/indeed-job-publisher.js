/**
 * Indeed Job Publisher
 *
 * Posts a job through the Indeed employer area using an authenticated Playwright page
 * (from testIndeedSession(account, true) in libs/indeed-session-validator.js).
 *
 * NOT BUILT YET. What the diagnostic runs showed (docs/ai-hiring/19, section 5c):
 *   - a hidden (headless) browser is blocked on employers.indeed.com by Cloudflare's bot check (HTTP 403);
 *   - a visible window with a person present passed the check (reported by the project owner, 2026-10-06).
 * So automatic posting is possible in principle: it needs a visible browser, a person for every check, sign-in and
 * decision, and input that behaves like typing. The real flow is mapped (docs/ai-hiring/19, section 5d: the steps,
 * their paths and the data-testid of each box), so the form steps can be written against it.
 * Until this exists, automatic posting is off (autoPostAvailability in libs/hiring/publishing.js) and recruiters post
 * with Copy and open; INDEED_AUTO_POST=true switches the automatic path on.
 *
 * @param {import('playwright').Page} page – authenticated Indeed employer page
 * @param {Object} job – the jobs row from the database
 * @param {{ recorder?: import('./indeed-debug').DebugRecorder }} [options]
 */

export async function publishIndeedJob(page, job, { recorder = null } = {}) {
  if (!page) return { success: false, error: "page is required" };
  if (!job) return { success: false, error: "job is required" };
  await recorder?.snap(page, "publisher-not-built", { note: "the Post a job steps are not built yet", inline: true });
  return {
    success: false,
    code: "ui_changed",
    error: "Posting to Indeed in the background is not built. Use the posting engine (a window you watch) or Copy and open.",
  };
}
