import { NextResponse } from "next/server";
import { ApifyClient as JobRunnerClient } from "apify-client";
import { getScraperServiceTokenFromEnv } from "@/libs/scraper-credentials";

export async function POST(request) {
  try {
    const body = await request.json();
    const { urls, limitPerSource = 10, deepScrape = true, rawData = false, streamProgress = false } = body || {};

    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ error: 'urls must be a non-empty array' }, { status: 400 });
    }

    const token = getScraperServiceTokenFromEnv();
    if (!token) {
      return NextResponse.json({
        error: "Profile scraping isn’t configured on this server.",
      }, { status: 500 });
    }

    const client = new JobRunnerClient({ token });

    const input = {
      urls,
      limitPerSource,
      deepScrape,
      rawData,
    };

    console.log("Profile scrape input:", input);
    const run = await client.actor('Wpp1BZ6yGWjySadk3').call(input);
    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    console.log("Profile scrape items:", items.length);
    if (items.length > 0) {
      console.log("Sample item structure:", JSON.stringify(items[0], null, 2));
    }

    // Prefer inputUrl from runner response for post-to-lead assignment
    const itemsWithSource = items.map((item) => {
      return {
        ...item,
        sourceUrl: item.inputUrl || item.sourceUrl // Use inputUrl if available, fallback to sourceUrl
      };
    });

    console.log("Items with source:", itemsWithSource.length);

    return NextResponse.json({ items: itemsWithSource, runId: run.id });
  } catch (error) {
    console.error('Scrape API error', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}