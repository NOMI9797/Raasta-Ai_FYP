/**
 * Rozee.pk Session Validator
 *
 * Hydrates a Playwright context from stored Rozee session data and verifies
 * the session is still authenticated by hitting the Rozee dashboard.
 */

import { DEFAULT_BROWSER_ARGS, restoreSessionToContext } from "./playwright-utils";

const ROZEE_AUTHENTICATED_URLS = [
  "rozee.pk/my/",
  "rozee.pk/dashboard",
  "rozee.pk/recruiter",
  "rozee.pk/account",
];

const ROZEE_LOGIN_URLS = [
  "rozee.pk/user/login",
  "rozee.pk/login",
];

export async function testRozeeSession(sessionData, keepOpen = false) {
  console.log("Testing Rozee.pk session validity...");

  try {
    const { chromium } = await import("playwright");

    const context = await chromium.launchPersistentContext(
      `/tmp/rozee-test-${sessionData.sessionId || Date.now()}`,
      {
        headless: true,
        viewport: { width: 1280, height: 720 },
        args: DEFAULT_BROWSER_ARGS,
      }
    );

    const page = context.pages()[0] || (await context.newPage());

    try {
      await restoreSessionToContext(context, page, sessionData);

      await page.goto("https://www.rozee.pk/my/dashboard", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.waitForTimeout(3000);

      const currentUrl = page.url();

      if (ROZEE_LOGIN_URLS.some((p) => currentUrl.includes(p))) {
        await context.close();
        return {
          isValid: false,
          reason: "Session expired — redirected to login",
          currentUrl,
        };
      }

      if (ROZEE_AUTHENTICATED_URLS.some((p) => currentUrl.includes(p))) {
        if (keepOpen) {
          return {
            isValid: true,
            reason: "Successfully accessed Rozee.pk authenticated page",
            currentUrl,
            context,
            page,
          };
        }
        await context.close();
        return {
          isValid: true,
          reason: "Successfully accessed Rozee.pk authenticated page",
          currentUrl,
        };
      }

      await context.close();
      return {
        isValid: false,
        reason: "Unexpected page after navigation",
        currentUrl,
      };
    } catch (error) {
      await context.close();
      return {
        isValid: false,
        reason: `Error testing Rozee session: ${error.message}`,
        currentUrl: null,
      };
    }
  } catch (error) {
    return {
      isValid: false,
      reason: `Browser launch failed: ${error.message}`,
      currentUrl: null,
    };
  }
}

export async function validateAndKeepOpen(accountData) {
  return await testRozeeSession(accountData, true);
}

export async function cleanupBrowserSession(context) {
  try {
    if (context) await context.close();
  } catch (err) {
    console.error("Failed to close Rozee browser session:", err.message);
  }
}
