/**
 * LinkedIn Post Scraper Module
 * 
 * Scrapes posts from LinkedIn profiles using an existing authenticated
 * Playwright session. Integrates directly with the existing invite automation.
 * 
 * Usage (for documentation/demo purposes):
 *   import { scrapeProfilePosts, scrapeMultipleProfiles } from './linkedin-post-scraper';
 */

const DEBUG_MODE = process.env.ENABLE_DEBUG === 'true' || process.env.NODE_ENV === 'development';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const SCRAPE_CONFIG = {
  maxPostsPerProfile: 10,        // How many posts to scrape per profile
  scrollAttempts: 3,             // How many times to scroll to load more posts
  scrollDelay: 2000,             // ms between scrolls
  postLoadTimeout: 10000,        // ms to wait for posts to appear
  rateLimitDelay: { min: 5000, max: 12000 }, // ms between profiles (human-like)
};

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function randomDelay(min, max) {
  return min + Math.floor(Math.random() * (max - min));
}

function log(msg) {
  console.log(`[Scraper] ${msg}`);
}

async function captureDebugScreenshot(page, label) {
  if (!DEBUG_MODE) return;
  try {
    const fs = await import('fs');
    await fs.promises.mkdir('./debug-scraper', { recursive: true });
    const path = `./debug-scraper/scrape-${label}-${Date.now()}.png`;
    await page.screenshot({ path, fullPage: false });
    log(`📸 Screenshot: ${path}`);
  } catch (e) {
    // ignore
  }
}

// ─────────────────────────────────────────────
// CORE: Wait for posts to load
// ─────────────────────────────────────────────

async function waitForPostsToLoad(page) {
  log('⏳ Waiting for posts to load...');

  // LinkedIn activity page uses these containers
  const postSelectors = [
    '.feed-shared-update-v2',
    '[data-urn*="activity"]',
    '.occludable-update',
    '.profile-creator-shared-feed-update__container',
  ];

  for (const selector of postSelectors) {
    try {
      await page.waitForSelector(selector, { timeout: SCRAPE_CONFIG.postLoadTimeout });
      log(`✅ Posts loaded (selector: ${selector})`);
      return selector;
    } catch (e) {
      continue;
    }
  }

  log('⚠️ Posts did not load within timeout');
  return null;
}

// ─────────────────────────────────────────────
// CORE: Scroll to load more posts
// ─────────────────────────────────────────────

async function scrollToLoadMore(page, attempts) {
  for (let i = 0; i < attempts; i++) {
    await page.evaluate(() => window.scrollBy(0, 1200));
    await page.waitForTimeout(SCRAPE_CONFIG.scrollDelay);
    log(`🔽 Scroll ${i + 1}/${attempts}`);
  }
  // Scroll back to top so layout is clean
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
}

// ─────────────────────────────────────────────
// CORE: Extract posts from page DOM
// ─────────────────────────────────────────────

async function extractPostsFromDOM(page, maxPosts) {
  return await page.evaluate((max) => {
    const results = [];

    // Try all known LinkedIn post container selectors
    const containerSelectors = [
      '.feed-shared-update-v2',
      '[data-urn*="activity"]',
      '.occludable-update',
      '.profile-creator-shared-feed-update__container',
    ];

    let containers = [];
    for (const sel of containerSelectors) {
      const found = Array.from(document.querySelectorAll(sel));
      if (found.length > 0) {
        containers = found;
        break;
      }
    }

    for (const container of containers.slice(0, max)) {
      try {
        // ── Post text ──────────────────────────────────
        const textEl =
          container.querySelector('.feed-shared-text') ||
          container.querySelector('.feed-shared-update-v2__description') ||
          container.querySelector('[data-test-id="main-feed-activity-card__commentary"]') ||
          container.querySelector('.break-words');

        const text = textEl?.innerText?.trim() || null;
        if (!text) continue; // skip reposts/share-only posts with no text

        // ── Timestamp ─────────────────────────────────
        const timeEl =
          container.querySelector('time') ||
          container.querySelector('.feed-shared-actor__sub-description') ||
          container.querySelector('.update-components-actor__sub-description');

        const timestamp =
          timeEl?.getAttribute('datetime') ||
          timeEl?.innerText?.trim() ||
          null;

        // ── Engagement ────────────────────────────────
        const likesEl =
          container.querySelector('.social-details-social-counts__reactions-count') ||
          container.querySelector('[aria-label*="reaction"]') ||
          container.querySelector('.feed-shared-social-action-bar__action-count');

        const likes = likesEl?.innerText?.trim() || '0';

        const commentsEl =
          container.querySelector('.social-details-social-counts__comments') ||
          container.querySelector('[aria-label*="comment"]');

        const comments = commentsEl?.innerText?.trim() || '0';

        // ── Post URL ──────────────────────────────────
        const linkEl =
          container.querySelector('a[href*="/feed/update/"]') ||
          container.querySelector('a[href*="activity"]');

        const postUrl = linkEl?.href || null;

        // ── Post URN (unique ID) ───────────────────────
        const urn =
          container.getAttribute('data-urn') ||
          container.querySelector('[data-urn]')?.getAttribute('data-urn') ||
          null;

        // ── Media type ────────────────────────────────
        const hasImage = !!container.querySelector(
          '.feed-shared-image__container, .update-components-image'
        );
        const hasVideo = !!container.querySelector(
          '.feed-shared-linkedin-video, .update-components-linkedin-video'
        );
        const hasArticle = !!container.querySelector(
          '.feed-shared-article, .update-components-article'
        );

        let mediaType = 'text';
        if (hasImage) mediaType = 'image';
        if (hasVideo) mediaType = 'video';
        if (hasArticle) mediaType = 'article';

        results.push({
          text,
          timestamp,
          likes,
          comments,
          postUrl,
          urn,
          mediaType,
        });
      } catch (e) {
        continue;
      }
    }

    return results;
  }, maxPosts);
}

// ─────────────────────────────────────────────
// PUBLIC: Scrape posts for a single profile
// ─────────────────────────────────────────────

/**
 * Scrape posts from a single LinkedIn profile.
 * 
 * @param {Page} page - Playwright page (must have active LinkedIn session)
 * @param {string} profileUrl - LinkedIn profile URL
 * @param {object} options - Optional overrides
 * @param {number} options.maxPosts - Max posts to return (default: 10)
 * @param {number} options.scrollAttempts - Scroll attempts (default: 3)
 * @returns {Promise<{ profileUrl: string, posts: Array, scrapedAt: string, error?: string }>}
 */
export async function scrapeProfilePosts(page, profileUrl, options = {}) {
  const maxPosts = options.maxPosts ?? SCRAPE_CONFIG.maxPostsPerProfile;
  const scrollAttempts = options.scrollAttempts ?? SCRAPE_CONFIG.scrollAttempts;

  log(`🔍 Scraping posts for: ${profileUrl}`);

  const result = {
    profileUrl,
    posts: [],
    scrapedAt: new Date().toISOString(),
  };

  try {
    // Navigate to the profile's activity/posts page
    const activityUrl = profileUrl.replace(/\/$/, '') + '/recent-activity/all/';
    log(`🌐 Navigating to: ${activityUrl}`);

    await page.goto(activityUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });

    await captureDebugScreenshot(page, 'after_navigate');

    // Wait for posts to appear
    const loadedSelector = await waitForPostsToLoad(page);

    if (!loadedSelector) {
      // Try the main profile page as fallback
      log('⚠️ Activity page failed, trying profile page directly...');
      await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
    }

    // Scroll to load more posts
    await scrollToLoadMore(page, scrollAttempts);
    await captureDebugScreenshot(page, 'after_scroll');

    // Extract posts
    const posts = await extractPostsFromDOM(page, maxPosts);
    log(`✅ Extracted ${posts.length} posts`);

    result.posts = posts;

  } catch (error) {
    log(`❌ Error scraping ${profileUrl}: ${error.message}`);
    result.error = error.message;
  }

  return result;
}

// ─────────────────────────────────────────────
// PUBLIC: Scrape multiple profiles
// ─────────────────────────────────────────────

/**
 * Scrape posts from multiple LinkedIn profiles with rate limiting.
 * 
 * @param {Page} page - Playwright page (must have active LinkedIn session)
 * @param {Array<{ id: string, url: string, name?: string }>} leads - Array of lead objects
 * @param {object} options - Optional config overrides
 * @param {Function} progressCallback - Optional progress callback
 * @returns {Promise<Array<{ leadId, profileUrl, posts, scrapedAt, error? }>>}
 */
export async function scrapeMultipleProfiles(page, leads, options = {}, progressCallback = null) {
  log(`🚀 Starting scrape for ${leads.length} profile(s)...`);

  const results = [];

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];

    if (!lead.url) {
      log(`⚠️ Skipping lead ${lead.id} — no URL`);
      results.push({ leadId: lead.id, profileUrl: null, posts: [], error: 'No URL', scrapedAt: new Date().toISOString() });
      continue;
    }

    log(`📤 [${i + 1}/${leads.length}] ${lead.name || lead.id}`);

    if (progressCallback) {
      await progressCallback({ type: 'progress', current: i, total: leads.length, leadId: lead.id, stage: 'scraping' });
    }

    const scrapeResult = await scrapeProfilePosts(page, lead.url, options);
    results.push({ leadId: lead.id, ...scrapeResult });

    log(`📊 Got ${scrapeResult.posts.length} posts for ${lead.name || lead.id}`);

    // Rate limit between profiles (skip delay after last one)
    if (i < leads.length - 1) {
      const delay = randomDelay(
        SCRAPE_CONFIG.rateLimitDelay.min,
        SCRAPE_CONFIG.rateLimitDelay.max
      );
      log(`⏱️ Waiting ${Math.floor(delay / 1000)}s before next profile...`);
      await page.waitForTimeout(delay);
    }
  }

  log(`\n${'='.repeat(50)}`);
  log(`✅ Scraping complete`);
  log(`   Profiles: ${results.length}`);
  log(`   Total posts: ${results.reduce((sum, r) => sum + r.posts.length, 0)}`);
  log(`   Errors: ${results.filter(r => r.error).length}`);
  log(`${'='.repeat(50)}\n`);

  return results;
}

// ─────────────────────────────────────────────
// PUBLIC: Scrape + save to JSON file
// ─────────────────────────────────────────────

/**
 * Scrape profiles and save results to a JSON file.
 * Useful for batch scraping jobs.
 * 
 * @param {Page} page - Playwright page
 * @param {Array} leads - Lead objects
 * @param {string} outputPath - Path to save JSON results
 * @returns {Promise<Array>} - Scraped results
 */
export async function scrapeAndSave(page, leads, outputPath = './scraped-posts.json') {
  const results = await scrapeMultipleProfiles(page, leads);

  const fs = await import('fs');
  await fs.promises.writeFile(outputPath, JSON.stringify(results, null, 2), 'utf-8');
  log(`💾 Results saved to: ${outputPath}`);

  return results;
}

// ─────────────────────────────────────────────
// INTEGRATION: Works with existing processInvitesDirectly
// ─────────────────────────────────────────────

/**
 * Scrape posts DURING an existing invite session.
 * Call this after page.goto(lead.url) is already done in processInvitesDirectly,
 * so you don't need to navigate again — reuse the already-loaded profile page.
 * 
 * @param {Page} page - Already navigated to profile page
 * @param {string} profileUrl - Profile URL (for reference)
 * @returns {Promise<Array>} - Posts array
 */
export async function scrapeCurrentProfilePage(page, profileUrl) {
  log(`🔍 Scraping current profile page: ${profileUrl}`);

  try {
    // Navigate to the activity tab (same profile, different tab)
    const activityUrl = profileUrl.replace(/\/$/, '') + '/recent-activity/all/';
    await page.goto(activityUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await waitForPostsToLoad(page);
    await scrollToLoadMore(page, 2); // fewer scrolls when embedded in invite flow

    const posts = await extractPostsFromDOM(page, SCRAPE_CONFIG.maxPostsPerProfile);
    log(`✅ Scraped ${posts.length} posts from current profile`);

    // Navigate BACK to the profile page so the invite flow can continue normally
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);

    return posts;
  } catch (e) {
    log(`❌ scrapeCurrentProfilePage error: ${e.message}`);
    return [];
  }
}

