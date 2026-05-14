/**
 * Server-side scraping service credentials (Indeed job search + LinkedIn profile scrape route).
 * Neutral env names preferred; legacy keys remain supported.
 */
export function getScraperServiceTokenFromEnv() {
  const t = String(
    process.env.SCRAPER_API_TOKEN ||
      process.env.SCRAPER_SERVICE_TOKEN ||
      process.env.APIFY_API_TOKEN ||
      process.env.apify_api_token ||
      process.env.APIFY_TOKEN ||
      ""
  ).trim();
  return t || null;
}

export function isScraperServiceConfigured() {
  return Boolean(getScraperServiceTokenFromEnv());
}
