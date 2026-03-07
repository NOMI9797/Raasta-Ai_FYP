import { NextResponse } from "next/server";
import { ApifyClient } from "apify-client";
import { withAuth } from "@/libs/auth-middleware";

export const POST = withAuth(async (request, { user }) => {
  try {
    const body = await request.json();
    const { urls, limitPerSource = 10, deepScrape = true, rawData = false, streamProgress = false } = body || {};

    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ error: 'urls must be a non-empty array' }, { status: 400 });
    }

    const token = process.env.APIFY_API_TOKEN || process.env.apify_api_token || process.env.APIFY_TOKEN;
    if (!token) {
      return NextResponse.json({ error: 'APIFY_API_TOKEN is not configured on the server' }, { status: 500 });
    }

    const client = new ApifyClient({ token });

    const input = {
      urls,
      limitPerSource,
      deepScrape,
      rawData,
    };

    console.log("Apify input:", input);

    // Regular non-streaming response (matching Reachly exactly)
    const run = await client.actor('Wpp1BZ6yGWjySadk3').call(input);
    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    console.log("Apify raw items:", items.length);
    if (items.length > 0) {
      console.log("Sample item structure:", JSON.stringify(items[0], null, 2));
    }

    // Use inputUrl from Apify response for accurate post-to-lead assignment
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
});