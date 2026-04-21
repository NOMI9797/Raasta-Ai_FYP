import { NextResponse } from 'next/server';
import { withAuth } from '@/libs/auth-middleware';
import { db } from '@/libs/db';
import { leads, rozeeAccounts } from '@/libs/schema';
import { eq, and } from 'drizzle-orm';
import RozeeSessionManager from '@/libs/rozee-session';
import { scrapeRozeeJobs } from '@/libs/rozee-job-scraper';

const sessionManager = new RozeeSessionManager();

/**
 * Scrape Rozee.pk jobs for a query and (optionally) insert them as leads
 * (source='rozee') into a campaign. Useful for surfacing hiring companies
 * to target for B2B outreach.
 *
 * Body:
 *   { query: string, campaignId?: string, limit?: number, persist?: boolean }
 */
export const POST = withAuth(async (request, { user }) => {
  try {
    const { query, campaignId, limit = 20, persist = false } = await request.json();
    if (!query) {
      return NextResponse.json({ error: 'query is required' }, { status: 400 });
    }

    let sessionData = null;
    const [activeAccount] = await db
      .select()
      .from(rozeeAccounts)
      .where(and(eq(rozeeAccounts.userId, user.id), eq(rozeeAccounts.isActive, true)))
      .limit(1);

    if (activeAccount) {
      sessionData = await sessionManager.loadSession(activeAccount.sessionId);
    }

    const jobs = await scrapeRozeeJobs({ query, sessionData, limit });

    let inserted = 0;
    if (persist && campaignId && jobs.length) {
      const rows = jobs
        .filter((j) => j.url)
        .map((j) => ({
          userId: user.id,
          campaignId,
          url: j.url,
          name: j.title || null,
          title: j.title || null,
          company: j.company || null,
          source: 'rozee',
          sourceData: j,
          status: 'pending',
        }));
      if (rows.length) {
        const result = await db.insert(leads).values(rows).returning({ id: leads.id });
        inserted = result.length;
      }
    }

    return NextResponse.json({
      success: true,
      query,
      count: jobs.length,
      inserted,
      jobs,
    });
  } catch (error) {
    console.error('Rozee jobs scrape error:', error);
    return NextResponse.json({ error: error.message || 'Failed to scrape Rozee jobs' }, { status: 500 });
  }
});
