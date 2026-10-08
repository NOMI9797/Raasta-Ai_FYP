/**
 * Rozee.pk Job Publisher: NOT BUILT, on purpose.
 *
 * This used to fill in www.rozee.pk/employer/job/post with guessed selectors and call any address containing "/job/" a success.
 * That form no longer exists: on 2026-10-08 a signed-in employer posts through RozeeGPT, an AI wizard on www.rozeegpt.ai that ends in a
 * dialog applying one of the account's free Featured Job credits or selling an upgrade (docs/ai-hiring/19, section 5g).
 * Posting in the background through a saved session, with nobody to make that choice, is therefore not offered
 * (autoPostAvailability in libs/hiring/publishing.js). Rozee.pk is posted with the posting engine (libs/poster/flow-rozee.js:
 * a visible window that fills the wizard in and stops before Publish Job) or with Copy and open.
 */

/**
 * @returns {Promise<{ success: false, code: string, error: string }>}
 */
export async function publishRozeeJob(page, job) {
  if (!page) return { success: false, error: "page is required" };
  if (!job) return { success: false, error: "job is required" };
  return {
    success: false,
    code: "ui_changed",
    error: "Posting to Rozee.pk in the background is not built. Use the posting engine (a window you watch) or Copy and open.",
  };
}
