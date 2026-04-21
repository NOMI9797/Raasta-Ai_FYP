/**
 * Rozee.pk Message Sender
 *
 * Sends an in-platform Rozee message to a candidate / employer profile using
 * an authenticated Playwright session.
 */

import { DEFAULT_BROWSER_ARGS, restoreSessionToContext, humanLikeDelay } from "./playwright-utils";

// ─── Selectors (TODO: validate against the live messaging UI) ───
export const ROZEE_MESSAGE_SELECTORS = {
  messageButton: "a.message-btn, button.message-btn, button:has-text('Message')",
  messageTextarea: "textarea[name='message'], textarea#message, .message-input",
  sendButton: "button[type='submit']:has-text('Send'), button.send-btn",
  successIndicator: ".message-sent, :has-text('message sent')",
};

/**
 * Send a message to a Rozee profile (candidate or employer).
 *
 * @param {Object} opts
 * @param {string} opts.profileUrl
 * @param {string} opts.message
 * @param {Object} opts.sessionData – Rozee account session
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function sendRozeeMessage({ profileUrl, message, sessionData } = {}) {
  if (!profileUrl) return { success: false, error: "profileUrl is required" };
  if (!message) return { success: false, error: "message is required" };
  if (!sessionData) return { success: false, error: "sessionData is required" };

  const { chromium } = await import("playwright");
  const context = await chromium.launchPersistentContext(
    `/tmp/rozee-msg-${Date.now()}`,
    { headless: true, viewport: { width: 1280, height: 800 }, args: DEFAULT_BROWSER_ARGS }
  );
  const page = context.pages()[0] || (await context.newPage());

  try {
    await restoreSessionToContext(context, page, sessionData);
    await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await humanLikeDelay(page, 1500, 2500);

    const msgBtn = await page.$(ROZEE_MESSAGE_SELECTORS.messageButton);
    if (!msgBtn) {
      await context.close();
      return { success: false, error: "Message button not found on profile" };
    }
    await msgBtn.click();
    await humanLikeDelay(page, 1200, 2200);

    const textarea = await page.$(ROZEE_MESSAGE_SELECTORS.messageTextarea);
    if (!textarea) {
      await context.close();
      return { success: false, error: "Message textarea not found" };
    }
    await textarea.fill(message);
    await humanLikeDelay(page, 800, 1500);

    const sendBtn = await page.$(ROZEE_MESSAGE_SELECTORS.sendButton);
    if (!sendBtn) {
      await context.close();
      return { success: false, error: "Send button not found" };
    }
    await sendBtn.click();
    await humanLikeDelay(page, 1500, 3000);

    await context.close();
    return { success: true };
  } catch (error) {
    await context.close();
    return { success: false, error: error.message };
  }
}
