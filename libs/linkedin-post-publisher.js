/**
 * Publishes a text post to LinkedIn via Playwright browser automation.
 *
 * Requires a validated, open Playwright session (context + page)
 * from testLinkedInSession(account, true).
 */

function randomDelay(min = 1000, max = 3000) {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min)
  );
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

    // Click the "Start a post" button
    const startPostBtn = page.locator(
      'button.share-box-feed-entry__trigger, button[aria-label*="Start a post" i], .share-box-feed-entry__trigger'
    );
    await startPostBtn.waitFor({ state: "visible", timeout: 15000 });
    await startPostBtn.click();
    console.log("✅ Post composer opened");
    await randomDelay(1500, 3000);

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

    // Click the Post button
    const postBtn = page.locator(
      'button.share-actions__primary-action, button[aria-label*="Post" i]:not([aria-label*="Start"]):not([aria-label*="post" i][aria-label*="Start"]), button:has-text("Post"):visible'
    ).first();
    await postBtn.waitFor({ state: "visible", timeout: 10000 });
    await postBtn.click();
    console.log("✅ Post button clicked — publishing...");
    await randomDelay(3000, 6000);

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
    return { success: false, error: err.message };
  }
}
