/**
 * Publishes a text post to LinkedIn via Playwright browser automation.
 *
 * Requires a validated, open Playwright session (context + page)
 * from testLinkedInSession(account, true).
 */

// Debug mode: Enable screenshots and verbose logging
const DEBUG_MODE =
  process.env.ENABLE_DEBUG === "true" ||
  process.env.NODE_ENV === "development";

function randomDelay(min = 1000, max = 3000) {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min)
  );
}

async function captureStepScreenshot(page, step) {
  if (!DEBUG_MODE) return;
  try {
    const fs = await import("fs");
    const dir = "./debug-recruiter-posts";
    await fs.promises.mkdir(dir, { recursive: true });
    const filePath = `${dir}/post-${step}-${Date.now()}.png`;
    await page.screenshot({ path: filePath, fullPage: false });
    console.log(
      `📸 [recruiter] Screenshot for step "${step}" saved to ${filePath}`
    );
  } catch (e) {
    console.log(
      `⚠️ [recruiter] Failed to capture screenshot for step "${step}":`,
      e.message
    );
  }
}

/**
 * @param {import('playwright').Page} page – An authenticated LinkedIn page
 * @param {string} postText – The text content to publish
 * @returns {Promise<{ success: boolean, postUrl?: string, error?: string }>}
 */
export async function publishLinkedInPost(page, postText) {
  try {
    console.log("📝 Navigating to LinkedIn feed to create a post...");
    await page.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await randomDelay(2000, 4000);
    await captureStepScreenshot(page, "after_navigate_feed");

    // A sign-in or security check means a person has to step in. Stop here instead of working around it.
    if (["/checkpoint", "/challenge", "/uas/", "/login", "/authwall"].some((part) => page.url().includes(part))) {
      return {
        success: false,
        code: "checkpoint",
        error: "LinkedIn is asking for a sign-in or security check. Open LinkedIn yourself to confirm it, then reconnect the account.",
      };
    }

    // Click the "Start a post" trigger
    const startPostSelectors = [
      // New UI: div with aria-label and visible "Start a post" text
      'div[aria-label*="Start a post" i]',
      'div[aria-label*="Start a post" i] p:has-text("Start a post")',
      // Legacy button-based selectors
      'button.share-box-feed-entry__trigger',
      'button[aria-label*="Start a post" i]',
      '.share-box-feed-entry__trigger',
    ];

    let startPostBtn = null;
    for (const selector of startPostSelectors) {
      const candidate = page.locator(selector).first();
      if (await candidate.isVisible({ timeout: 3000 }).catch(() => false)) {
        startPostBtn = candidate;
        console.log(`✅ Found "Start a post" trigger with selector: ${selector}`);
        break;
      }
    }

    if (!startPostBtn) {
      throw new Error('Could not find "Start a post" trigger on feed page');
    }

    await startPostBtn.click();
    console.log("✅ Post composer opened");
    await randomDelay(1500, 3000);
    await captureStepScreenshot(page, "after_open_composer");

    // The composer is a modal dialog. Everything from here on is looked up inside it, so a button in the feed
    // behind it (a post menu, Like, Comment) can never be clicked by mistake.
    const composer = page
      .locator('dialog[open], [role="dialog"]')
      .filter({ has: page.locator('div[role="textbox"], .ql-editor') })
      .first();
    await composer.waitFor({ state: "visible", timeout: 15000 });

    // Type into the rich-text editor
    const editor = composer.locator('.ql-editor, div[role="textbox"][contenteditable="true"], div[role="textbox"]').first();
    await editor.waitFor({ state: "visible", timeout: 10000 });
    await editor.click();
    await randomDelay(500, 1000);

    // Type in chunks. [\s\S] keeps the line breaks (a plain dot would drop them and run the paragraphs together).
    const chunks = postText.match(/[\s\S]{1,80}/g) || [postText];
    for (const chunk of chunks) {
      await editor.type(chunk, { delay: Math.floor(Math.random() * 30) + 10 });
      await randomDelay(200, 600);
    }

    console.log("✅ Post text entered");
    await randomDelay(1000, 2000);
    await captureStepScreenshot(page, "after_enter_text");

    // The Post button inside the composer (disabled until there is text, so the click waits for it to be enabled)
    const postCandidates = [
      composer.getByRole("button", { name: "Post", exact: true }),
      composer.locator("button").filter({ hasText: /^\s*Post\s*$/ }),
      composer.locator('button[aria-label="Post"]'),
    ];
    let postBtn = null;
    for (const candidate of postCandidates) {
      const button = candidate.last();
      if (await button.isVisible({ timeout: 4000 }).catch(() => false)) {
        postBtn = button;
        break;
      }
    }
    if (!postBtn) {
      return {
        success: false,
        code: "ui_changed",
        error: "Could not find the Post button in the LinkedIn composer. LinkedIn may have changed its page. Use Copy and open to post it yourself.",
      };
    }

    await postBtn.click({ timeout: 10000 });
    console.log("✅ Post button clicked — publishing...");
    await captureStepScreenshot(page, "after_click_post");

    // LinkedIn closes the composer once it accepts the post. If it stays open, nothing is confirmed.
    const closed = await composer.waitFor({ state: "hidden", timeout: 20000 }).then(() => true).catch(() => false);
    if (!closed) {
      return {
        success: false,
        code: "unconfirmed",
        error: "Clicked Post, but LinkedIn did not confirm it. Check your LinkedIn profile before posting again.",
      };
    }

    // No link is recorded: the first post in the feed is not necessarily this one, and a wrong link is worse than none
    console.log("🎉 Post published");
    return { success: true, postUrl: null };
  } catch (err) {
    console.error("❌ Failed to publish LinkedIn post:", String(err.message).split(String.fromCharCode(10))[0]);
    await captureStepScreenshot(page, "error_state");
    return { success: false, code: /Timeout .*exceeded/.test(err.message) ? "ui_changed" : undefined, error: err.message };
  }
}
