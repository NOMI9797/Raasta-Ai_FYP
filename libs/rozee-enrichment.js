/**
 * Rozee.pk Lead Enrichment Module
 *
 * Enriches leads scraped from Rozee.pk with company details, contact info,
 * social profiles, and LinkedIn company data.
 *
 * Enrichment pipeline per lead:
 *   1. Google Search  → find official company website URL
 *   2. Website Visit  → scrape emails, phones, social links, meta description
 *   3. LinkedIn Visit → scrape industry, size, HQ, founded (if LinkedIn found)
 *   4. Normalize      → merge all into unified enriched lead schema
 *
 * Usage:
 *   import { enrichLead, enrichLeadsBatch } from './rozee-enrichment';
 *
 *   // Single lead
 *   const enriched = await enrichLead(page, lead, { googleApiKey, searchEngineId });
 *
 *   // Batch
 *   const results = await enrichLeadsBatch(page, leads, { googleApiKey, searchEngineId });
 *
 * Environment variables required:
 *   GOOGLE_SEARCH_API_KEY   — Google Custom Search API key (100 free/day)
 *   GOOGLE_SEARCH_ENGINE_ID — Custom Search Engine ID (cx parameter)
 *
 * Optional (higher volume):
 *   SERP_API_KEY            — SerpAPI key (5000/mo paid plan)
 *   SCRAPER_SERVICE_TOKEN   — optional hosted SERP / search runner (legacy keys still supported)
 */

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────

const DEBUG_MODE = process.env.ENABLE_DEBUG === 'true' || process.env.NODE_ENV === 'development';

const ENRICH_CONFIG = {
  // Rate limiting between enrichment requests (human-like)
  rateLimitDelay: { min: 3000, max: 8000 },

  // How long to wait for a company website to load
  websiteLoadTimeout: 12000,

  // Max emails to extract per company
  maxEmails: 5,

  // Max phones to extract per company
  maxPhones: 3,

  // Pages to check on company website for contact info
  contactPageSuffixes: ['/contact', '/contact-us', '/about', '/about-us', '/team'],

  // Google Custom Search API endpoint
  googleSearchUrl: 'https://www.googleapis.com/customsearch/v1',

  // SerpAPI endpoint (alternative)
  serpApiUrl: 'https://serpapi.com/search.json',
};

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function log(msg) {
  console.log(`[Enrichment] ${msg}`);
}

function randomDelay(min, max) {
  return min + Math.floor(Math.random() * (max - min));
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function captureDebugScreenshot(page, label) {
  if (!DEBUG_MODE) return;
  try {
    const fs = await import('fs');
    await fs.promises.mkdir('./debug-enrichment', { recursive: true });
    const path = `./debug-enrichment/enrich-${label}-${Date.now()}.png`;
    await page.screenshot({ path, fullPage: false });
    log(`📸 Screenshot: ${path}`);
  } catch (e) { /* ignore */ }
}

// Clean and validate URL
function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// Extract root domain from URL for deduplication
function getRootDomain(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// STEP 1: GOOGLE SEARCH — Find Company URL
// ─────────────────────────────────────────────

/**
 * Search Google for the official company website using Custom Search API.
 * Falls back to SerpAPI if SERP_API_KEY is set.
 *
 * @param {string} companyName
 * @param {string} location
 * @param {object} options - { googleApiKey, searchEngineId, serpApiKey }
 * @returns {Promise<{ url: string|null, linkedinUrl: string|null, allResults: Array }>}
 */
async function findCompanyUrls(companyName, location, options = {}) {
  const googleApiKey = options.googleApiKey || process.env.GOOGLE_SEARCH_API_KEY;
  const searchEngineId = options.searchEngineId || process.env.GOOGLE_SEARCH_ENGINE_ID;
  const serpApiKey = options.serpApiKey || process.env.SERP_API_KEY;

  const query = `${companyName} ${location || ''} official website`.trim();
  log(`🔍 Google search: "${query}"`);

  let results = [];

  try {
    if (serpApiKey) {
      // SerpAPI — more reliable, higher volume
      results = await searchViaSerpApi(query, serpApiKey);
    } else if (googleApiKey && searchEngineId) {
      // Google Custom Search API — 100 free/day
      results = await searchViaGoogleApi(query, googleApiKey, searchEngineId);
    } else {
      log('⚠️ No search API key configured. Set GOOGLE_SEARCH_API_KEY or SERP_API_KEY.');
      return { url: null, linkedinUrl: null, allResults: [] };
    }
  } catch (e) {
    log(`❌ Google search failed: ${e.message}`);
    return { url: null, linkedinUrl: null, allResults: [] };
  }

  // Separate LinkedIn results from website results
  const linkedinResult = results.find(r =>
    r.url?.includes('linkedin.com/company') || r.url?.includes('linkedin.com/in/')
  );

  const websiteResult = results.find(r =>
    r.url &&
    !r.url.includes('rozee.pk') &&
    !r.url.includes('linkedin.com') &&
    !r.url.includes('facebook.com') &&
    !r.url.includes('indeed.com') &&
    !r.url.includes('glassdoor.com') &&
    isValidUrl(r.url)
  );

  log(`✅ Found website: ${websiteResult?.url || 'none'}`);
  log(`✅ Found LinkedIn: ${linkedinResult?.url || 'none'}`);

  return {
    url: websiteResult?.url || null,
    linkedinUrl: linkedinResult?.url || null,
    allResults: results,
  };
}

async function searchViaGoogleApi(query, apiKey, cx) {
  const url = `${ENRICH_CONFIG.googleSearchUrl}?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=5`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Google API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return (data.items || []).map(item => ({
    url: item.link,
    title: item.title,
    snippet: item.snippet,
  }));
}

async function searchViaSerpApi(query, apiKey) {
  const url = `${ENRICH_CONFIG.serpApiUrl}?q=${encodeURIComponent(query)}&api_key=${apiKey}&num=5&engine=google`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`SerpAPI error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return (data.organic_results || []).map(r => ({
    url: r.link,
    title: r.title,
    snippet: r.snippet,
  }));
}

// ─────────────────────────────────────────────
// STEP 2: WEBSITE SCRAPING — Extract Contact Info
// ─────────────────────────────────────────────

/**
 * Visit company website and extract all available contact and company info.
 *
 * @param {Page} page - Playwright page
 * @param {string} websiteUrl - Company website URL
 * @returns {Promise<object>} - Extracted company data
 */
async function scrapeCompanyWebsite(page, websiteUrl) {
  log(`🌐 Visiting company website: ${websiteUrl}`);

  const result = {
    website: websiteUrl,
    emails: [],
    phones: [],
    linkedin: null,
    twitter: null,
    facebook: null,
    instagram: null,
    youtube: null,
    description: null,
    industry: null,
    address: null,
    foundedYear: null,
    rawLinks: [],
  };

  try {
    // Visit main page
    await page.goto(websiteUrl, {
      waitUntil: 'domcontentloaded',
      timeout: ENRICH_CONFIG.websiteLoadTimeout,
    });
    await page.waitForTimeout(1500);
    await captureDebugScreenshot(page, 'company_homepage');

    // Extract from homepage
    const homepageData = await extractFromPage(page);
    mergePageData(result, homepageData);

    // Try contact page if email not found yet
    if (result.emails.length === 0) {
      const rootUrl = `${new URL(websiteUrl).protocol}//${new URL(websiteUrl).hostname}`;

      for (const suffix of ENRICH_CONFIG.contactPageSuffixes) {
        try {
          await page.goto(rootUrl + suffix, {
            waitUntil: 'domcontentloaded',
            timeout: 8000,
          });
          await page.waitForTimeout(800);

          const contactData = await extractFromPage(page);
          mergePageData(result, contactData);

          if (result.emails.length > 0) break; // found emails, stop
        } catch (e) {
          // Contact page doesn't exist, try next
          continue;
        }
      }
    }

    // Clean up
    result.emails = [...new Set(result.emails)].slice(0, ENRICH_CONFIG.maxEmails);
    result.phones = [...new Set(result.phones)].slice(0, ENRICH_CONFIG.maxPhones);

    log(`✅ Website scraped — emails: ${result.emails.length}, phones: ${result.phones.length}`);

  } catch (e) {
    log(`❌ Website scraping failed for ${websiteUrl}: ${e.message}`);
    result.error = e.message;
  }

  return result;
}

// Extract all useful data from the current page
async function extractFromPage(page) {
  return await page.evaluate(() => {
    const text = document.body?.innerText || '';
    const html = document.body?.innerHTML || '';

    // ── Emails ────────────────────────────────────────────────
    const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    const emails = (text.match(emailRegex) || [])
      .filter(e =>
        !e.includes('example.com') &&
        !e.includes('youremail') &&
        !e.includes('email@') &&
        !e.endsWith('.png') &&
        !e.endsWith('.jpg')
      );

    // ── Phones ────────────────────────────────────────────────
    const phoneRegex = /(\+92[\s\-]?[0-9]{3}[\s\-]?[0-9]{7}|0[0-9]{2,3}[\s\-]?[0-9]{7}|\+1[\s\-]?\(?[0-9]{3}\)?[\s\-]?[0-9]{3}[\s\-]?[0-9]{4})/g;
    const phones = (text.match(phoneRegex) || []).map(p => p.trim());

    // ── Social links ──────────────────────────────────────────
    const allLinks = Array.from(document.querySelectorAll('a[href]'))
      .map(a => a.href)
      .filter(h => h && h.startsWith('http'));

    const linkedin = allLinks.find(l => l.includes('linkedin.com/company') || l.includes('linkedin.com/in/')) || null;
    const twitter  = allLinks.find(l => l.includes('twitter.com/') || l.includes('x.com/')) || null;
    const facebook = allLinks.find(l => l.includes('facebook.com/') && !l.includes('share')) || null;
    const instagram= allLinks.find(l => l.includes('instagram.com/')) || null;
    const youtube  = allLinks.find(l => l.includes('youtube.com/')) || null;

    // ── Meta description ──────────────────────────────────────
    const metaDesc =
      document.querySelector('meta[name="description"]')?.getAttribute('content') ||
      document.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
      null;

    // ── Address signals ───────────────────────────────────────
    const addressEl =
      document.querySelector('[class*="address"]') ||
      document.querySelector('[itemtype*="PostalAddress"]') ||
      document.querySelector('address') ||
      null;
    const address = addressEl?.innerText?.trim().replace(/\s+/g, ' ') || null;

    // ── Year founded ──────────────────────────────────────────
    const foundedMatch = text.match(/(?:founded|established|since|est\.?)\s*(?:in\s*)?(\d{4})/i);
    const foundedYear = foundedMatch ? foundedMatch[1] : null;

    return { emails, phones, linkedin, twitter, facebook, instagram, youtube, description: metaDesc, address, foundedYear, rawLinks: allLinks.slice(0, 20) };
  });
}

function mergePageData(target, source) {
  if (source.emails?.length)    target.emails.push(...source.emails);
  if (source.phones?.length)    target.phones.push(...source.phones);
  if (!target.linkedin && source.linkedin)   target.linkedin   = source.linkedin;
  if (!target.twitter && source.twitter)     target.twitter    = source.twitter;
  if (!target.facebook && source.facebook)   target.facebook   = source.facebook;
  if (!target.instagram && source.instagram) target.instagram  = source.instagram;
  if (!target.youtube && source.youtube)     target.youtube    = source.youtube;
  if (!target.description && source.description) target.description = source.description;
  if (!target.address && source.address)     target.address    = source.address;
  if (!target.foundedYear && source.foundedYear) target.foundedYear = source.foundedYear;
  if (source.rawLinks?.length) target.rawLinks.push(...source.rawLinks);
}

// ─────────────────────────────────────────────
// STEP 3: LINKEDIN COMPANY PAGE ENRICHMENT
// ─────────────────────────────────────────────

/**
 * Scrape LinkedIn company page for structured company metadata.
 * Requires existing LinkedIn authenticated session in the Playwright page.
 *
 * @param {Page} page - Playwright page (must have active LinkedIn session)
 * @param {string} linkedinUrl - LinkedIn company page URL
 * @returns {Promise<object>} - LinkedIn company data
 */
async function scrapeLinkedInCompany(page, linkedinUrl) {
  log(`💼 Scraping LinkedIn company: ${linkedinUrl}`);

  try {
    await page.goto(linkedinUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);
    await captureDebugScreenshot(page, 'linkedin_company');

    const data = await page.evaluate(() => {
      // LinkedIn company page selectors (may need updates if LinkedIn changes DOM)
      const getText = (selector) =>
        document.querySelector(selector)?.innerText?.trim() || null;

      // About section — try multiple selector patterns
      const industry =
        getText('[data-test-id="about-us__industry"] dd') ||
        getText('.org-page-details__definition-text') ||
        document.querySelector('.org-about-company-module__company-staff-count-range')?.innerText?.trim() ||
        null;

      const size =
        getText('[data-test-id="about-us__size"] dd') ||
        document.querySelector('[data-test-id="about-us__size"]')?.innerText?.trim() ||
        null;

      const headquarters =
        getText('[data-test-id="about-us__headquarters"] dd') ||
        getText('.org-page-details__definition-text + .org-page-details__definition-text') ||
        null;

      const founded =
        getText('[data-test-id="about-us__foundedOn"] dd') ||
        null;

      const specialties =
        getText('[data-test-id="about-us__specialties"] dd') ||
        null;

      const followers =
        document.querySelector('.org-top-card-summary-info-list__info-item')?.innerText?.trim() ||
        null;

      const website =
        getText('[data-test-id="about-us__website"] a') ||
        document.querySelector('a[data-control-name="visit_company_website"]')?.href ||
        null;

      const description =
        document.querySelector('.org-about-us-organization-description__text')?.innerText?.trim() ||
        document.querySelector('[data-test-id="about-us__description"]')?.innerText?.trim() ||
        null;

      return { industry, size, headquarters, founded, specialties, followers, website, description };
    });

    log(`✅ LinkedIn data: industry=${data.industry}, size=${data.size}`);
    return { linkedinData: data, linkedinUrl };

  } catch (e) {
    log(`❌ LinkedIn scraping failed: ${e.message}`);
    return { linkedinData: null, linkedinUrl, error: e.message };
  }
}

// ─────────────────────────────────────────────
// STEP 4: NORMALIZE — Unified Enriched Lead
// ─────────────────────────────────────────────

/**
 * Merge all enrichment data sources into a single normalized lead object.
 *
 * @param {object} originalLead - Lead from Rozee scraper
 * @param {object} websiteData - Data from scrapeCompanyWebsite()
 * @param {object} linkedinData - Data from scrapeLinkedInCompany()
 * @param {object} searchResults - Data from findCompanyUrls()
 * @returns {object} - Fully enriched lead
 */
function normalizeEnrichedLead(originalLead, websiteData = {}, linkedinResult = {}, searchResults = {}) {
  const linkedin = linkedinResult?.linkedinData || {};

  return {
    // ── Original Rozee data ──────────────────
    ...originalLead,

    // ── Enrichment metadata ──────────────────
    enrichedAt: new Date().toISOString(),
    enrichmentSource: buildSourceList(websiteData, linkedinResult),

    // ── Company contact ──────────────────────
    companyWebsite: websiteData.website || null,
    companyEmails: websiteData.emails || [],
    primaryEmail: websiteData.emails?.[0] || null,
    companyPhones: websiteData.phones || [],
    primaryPhone: websiteData.phones?.[0] || null,

    // ── Social profiles ──────────────────────
    linkedinCompanyUrl: linkedinResult.linkedinUrl || websiteData.linkedin || searchResults.linkedinUrl || null,
    twitterUrl: websiteData.twitter || null,
    facebookUrl: websiteData.facebook || null,
    instagramUrl: websiteData.instagram || null,
    youtubeUrl: websiteData.youtube || null,

    // ── Company details ──────────────────────
    companyDescription: linkedin.description || websiteData.description || null,
    companyIndustry: linkedin.industry || originalLead.industry || null,
    companySize: linkedin.size || null,
    companyHeadquarters: linkedin.headquarters || websiteData.address || originalLead.location || null,
    companyFounded: linkedin.founded || websiteData.foundedYear || null,
    companySpecialties: linkedin.specialties || null,
    linkedinFollowers: linkedin.followers || null,
    linkedinWebsite: linkedin.website || null,

    // ── Search metadata ──────────────────────
    googleSearchResults: searchResults.allResults?.slice(0, 3) || [],
  };
}

function buildSourceList(websiteData, linkedinResult) {
  const sources = ['rozee'];
  if (websiteData?.website) sources.push('website');
  if (linkedinResult?.linkedinData) sources.push('linkedin');
  return sources;
}

// ─────────────────────────────────────────────
// PUBLIC: Enrich a single lead
// ─────────────────────────────────────────────

/**
 * Run the full enrichment pipeline for a single Rozee lead.
 *
 * @param {Page} page - Playwright page (with active LinkedIn session for best results)
 * @param {object} lead - Lead object from rozee-integration scraper
 * @param {object} options - { googleApiKey, searchEngineId, serpApiKey, skipLinkedIn }
 * @returns {Promise<object>} - Enriched lead with all available company data
 */
export async function enrichLead(page, lead, options = {}) {
  log(`\n🚀 Enriching lead: ${lead.company || lead.companyName || 'Unknown'}`);

  const companyName = lead.company || lead.companyName || '';
  const location    = lead.location || lead.city || '';

  if (!companyName) {
    log('⚠️ No company name — skipping enrichment');
    return { ...lead, enrichedAt: new Date().toISOString(), enrichmentSource: ['rozee'] };
  }

  let websiteData   = {};
  let linkedinResult = {};
  let searchResults  = {};

  try {
    // ── Step 1: Google Search ─────────────────
    searchResults = await findCompanyUrls(companyName, location, options);
    await sleep(randomDelay(1000, 2500));

    // ── Step 2: Website scraping ──────────────
    if (searchResults.url) {
      websiteData = await scrapeCompanyWebsite(page, searchResults.url);
      await sleep(randomDelay(1500, 3000));
    }

    // ── Step 3: LinkedIn enrichment ───────────
    const linkedinUrl =
      searchResults.linkedinUrl ||
      websiteData.linkedin ||
      lead.linkedinCompanyUrl ||
      null;

    if (linkedinUrl && !options.skipLinkedIn) {
      linkedinResult = await scrapeLinkedInCompany(page, linkedinUrl);
      await sleep(randomDelay(2000, 4000));
    }

    // ── Step 4: Normalize ─────────────────────
    const enriched = normalizeEnrichedLead(lead, websiteData, linkedinResult, searchResults);

    log(`✅ Enrichment complete for ${companyName}`);
    log(`   Emails: ${enriched.companyEmails.length} | Phone: ${enriched.primaryPhone || 'none'} | LinkedIn: ${enriched.linkedinCompanyUrl ? 'yes' : 'no'}`);

    return enriched;

  } catch (e) {
    log(`❌ Enrichment failed for ${companyName}: ${e.message}`);
    return {
      ...lead,
      enrichedAt: new Date().toISOString(),
      enrichmentSource: ['rozee'],
      enrichmentError: e.message,
    };
  }
}

// ─────────────────────────────────────────────
// PUBLIC: Enrich multiple leads (batch)
// ─────────────────────────────────────────────

/**
 * Enrich an array of Rozee leads with rate limiting between each.
 *
 * @param {Page} page - Playwright page
 * @param {Array} leads - Array of lead objects from rozee-integration
 * @param {object} options - { googleApiKey, searchEngineId, serpApiKey, skipLinkedIn }
 * @param {Function} progressCallback - Optional progress callback
 * @returns {Promise<Array>} - Array of enriched leads
 */
export async function enrichLeadsBatch(page, leads, options = {}, progressCallback = null) {
  log(`\n🚀 Starting batch enrichment for ${leads.length} leads...`);

  const results  = [];
  const failures = [];

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];

    log(`\n📤 [${i + 1}/${leads.length}] ${lead.company || lead.companyName || lead.id}`);

    if (progressCallback) {
      await progressCallback({
        type: 'progress',
        current: i + 1,
        total: leads.length,
        leadId: lead.id,
        stage: 'enriching',
      });
    }

    const enriched = await enrichLead(page, lead, options);
    results.push(enriched);

    if (enriched.enrichmentError) {
      failures.push({ leadId: lead.id, error: enriched.enrichmentError });
    }

    // Rate limit between leads
    if (i < leads.length - 1) {
      const delay = randomDelay(ENRICH_CONFIG.rateLimitDelay.min, ENRICH_CONFIG.rateLimitDelay.max);
      log(`⏱️ Waiting ${Math.floor(delay / 1000)}s before next lead...`);
      await sleep(delay);
    }
  }

  log(`\n${'='.repeat(50)}`);
  log(`✅ Batch enrichment complete`);
  log(`   Total:    ${results.length}`);
  log(`   Success:  ${results.length - failures.length}`);
  log(`   Failed:   ${failures.length}`);
  if (failures.length > 0) {
    log(`   Failures: ${failures.map(f => f.leadId).join(', ')}`);
  }
  log(`${'='.repeat(50)}\n`);

  return results;
}

// ─────────────────────────────────────────────
// PUBLIC: Save enriched leads to JSON
// ─────────────────────────────────────────────

/**
 * Enrich leads and save results to a JSON file.
 *
 * @param {Page} page - Playwright page
 * @param {Array} leads - Lead objects from rozee-integration
 * @param {string} outputPath - Path to save results
 * @param {object} options - Enrichment options
 * @returns {Promise<Array>} - Enriched leads
 */
export async function enrichAndSave(page, leads, outputPath = './enriched-leads.json', options = {}) {
  const results = await enrichLeadsBatch(page, leads, options);
  const fs = await import('fs');
  await fs.promises.writeFile(outputPath, JSON.stringify(results, null, 2), 'utf-8');
  log(`💾 Enriched leads saved to: ${outputPath}`);
  return results;
}

// ─────────────────────────────────────────────
// INTEGRATION EXAMPLE
// ─────────────────────────────────────────────

/**
 * Example: scrape Rozee jobs then enrich all leads in one pipeline.
 *
 * import { scrapeRozeeJobs } from './rozee-integration';
 * import { enrichLeadsBatch } from './rozee-enrichment';
 *
 * // 1. Scrape leads from Rozee
 * const rawLeads = await scrapeRozeeJobs(page, 'software engineer', { maxJobs: 20 });
 *
 * // 2. Enrich with company data
 * const enrichedLeads = await enrichLeadsBatch(page, rawLeads, {
 *   googleApiKey: process.env.GOOGLE_SEARCH_API_KEY,
 *   searchEngineId: process.env.GOOGLE_SEARCH_ENGINE_ID,
 * });
 *
 * // 3. Save to DB
 * await db.insert(leads).values(
 *   enrichedLeads.map(l => normalizeToDbSchema(l))
 * );
 *
 * Each enriched lead contains:
 * {
 *   // Original Rozee fields
 *   company, title, location, rozeeUrl, source: 'rozee',
 *
 *   // Enriched fields
 *   companyWebsite, primaryEmail, companyEmails[],
 *   primaryPhone, companyPhones[],
 *   linkedinCompanyUrl, twitterUrl, facebookUrl,
 *   companyDescription, companyIndustry, companySize,
 *   companyHeadquarters, companyFounded, companySpecialties,
 *   linkedinFollowers, enrichedAt, enrichmentSource[]
 * }
 */
