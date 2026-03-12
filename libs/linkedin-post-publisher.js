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

    // Type into the rich-text editor
    const editor = page.locator(
      '.ql-editor[data-placeholder], .ql-editor, div[role="textbox"][aria-label*="post" i], div[role="textbox"][contenteditable="true"]'
    );
    await editor.waitFor({ state: "visible", timeout: 10000 });
    await editor.click();
    await randomDelay(500, 1000);

    // Type text in chunks to look human-like
    const chunks = postText.match(/.{1,80}/g) || [postText];
    for (const chunk of chunks) {
      await editor.type(chunk, { delay: Math.floor(Math.random() * 30) + 10 });
      await randomDelay(200, 600);
    }

    console.log("✅ Post text entered");
    await randomDelay(1000, 2000);
    await captureStepScreenshot(page, "after_enter_text");

    // Click the Post button
    const postSelectors = [
      // Primary: button with inner span.artdeco-button__text = "Post"
      'button:has(span.artdeco-button__text:text-is("Post"))',
      // Fallbacks
      'button.share-actions__primary-action',
      'button[aria-label*="Post" i]:not([aria-label*="Start"])',
      'button:has-text("Post")',
    ];

    let postBtn = null;
    for (const selector of postSelectors) {
      const candidate = page.locator(selector).first();
      if (await candidate.isVisible({ timeout: 4000 }).catch(() => false)) {
        postBtn = candidate;
        console.log(`✅ Found "Post" button with selector: ${selector}`);
        break;
      }
    }

    if (!postBtn) {
      throw new Error('Could not find "Post" button in composer');
    }

    await postBtn.click();
    console.log("✅ Post button clicked — publishing...");
    await randomDelay(3000, 6000);
    await captureStepScreenshot(page, "after_click_post");

    // Try to grab the URL of the new post from the feed
    let postUrl = null;
    try {
      const latestPost = page.locator(
        'a[href*="/feed/update/urn:li:activity:"]'
      ).first();
      if (await latestPost.isVisible({ timeout: 5000 }).catch(() => false)) {
        const href = await latestPost.getAttribute("href");
        if (href) postUrl = new URL(href, "https://www.linkedin.com").href;
      }
    } catch {}

    console.log("🎉 Post published successfully!", postUrl || "");
    return { success: true, postUrl };
  } catch (err) {
    console.error("❌ Failed to publish LinkedIn post:", err.message);
    await captureStepScreenshot(page, "error_state");
    return { success: false, error: err.message };
  }
}
