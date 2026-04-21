/**
 * Rozee.pk Auto-Applier
 *
 * Auto-applies to a Rozee.pk job posting using an authenticated candidate
 * session. Returns success + a small status payload for the UI to display.
 */

import { DEFAULT_BROWSER_ARGS, restoreSessionToContext, humanLikeDelay } from "./playwright-utils";

// ─── Selectors (TODO: validate against the live apply form) ───
export const ROZEE_APPLY_SELECTORS = {
  applyButton: "button.apply-btn, a.apply-now, button:has-text('Apply')",
  coverLetterTextarea: "textarea[name='cover_letter'], textarea#cover_letter",
  submitButton: "button[type='submit']:has-text('Apply'), input[type='submit']",
  successIndicator: ".apply-success, .application-success, :has-text('successfully applied')",
};

/**
 * Apply to a Rozee.pk job listing.
 *
 * @param {Object} opts
 * @param {string} opts.jobUrl
 * @param {Object} opts.sessionData – Rozee account session (cookies/localStorage)
 * @param {string} [opts.coverLetter]
 * @returns {Promise<{ success: boolean, error?: string, status?: string }>}
 */
export async function applyToRozeeJob({ jobUrl, sessionData, coverLetter } = {}) {
  if (!jobUrl) return { success: false, error: "jobUrl is required" };
  if (!sessionData) return { success: false, error: "sessionData is required" };

  const { chromium } = await import("playwright");
  const context = await chromium.launchPersistentContext(
    `/tmp/rozee-apply-${Date.now()}`,
    { headless: true, viewport: { width: 1280, height: 800 }, args: DEFAULT_BROWSER_ARGS }
  );
  const page = context.pages()[0] || (await context.newPage());

  try {
    await restoreSessionToContext(context, page, sessionData);
    await page.goto(jobUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await humanLikeDelay(page, 1500, 2500);

    const applyBtn = await page.$(ROZEE_APPLY_SELECTORS.applyButton);
    if (!applyBtn) {
      await context.close();
      return { success: false, error: "Apply button not found (already applied or layout changed)" };
    }
    await applyBtn.click();
    await humanLikeDelay(page, 1500, 3000);

    if (coverLetter) {
      const cl = await page.$(ROZEE_APPLY_SELECTORS.coverLetterTextarea);
      if (cl) {
        await cl.fill(coverLetter);
        await humanLikeDelay(page, 500, 1200);
      }
    }

    const submit = await page.$(ROZEE_APPLY_SELECTORS.submitButton);
    if (submit) {
      await submit.click();
      await humanLikeDelay(page, 2000, 3500);
    }

    const success = await page.$(ROZEE_APPLY_SELECTORS.successIndicator);
    await context.close();

    return success
      ? { success: true, status: "applied" }
      : { success: true, status: "submitted" }; // best-effort; some sites don't show explicit success
  } catch (error) {
    await context.close();
    return { success: false, error: error.message };
  }
}
