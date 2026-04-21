import { NextResponse } from 'next/server';
import { withAuth } from '@/libs/auth-middleware';
import { db } from '@/libs/db';
import { candidates as candidatesTable, rozeeAccounts } from '@/libs/schema';
import { eq, and } from 'drizzle-orm';
import { getAdapter } from '@/libs/platforms';

/**
 * Search Rozee CV database (or scrape a specific profile) and (optionally)
 * insert results as candidates for a job (source='rozee').
 *
 * Body:
 *   {
 *     query?: string,            // for CV-DB search
 *     profileUrl?: string,       // for single-profile scrape
 *     jobId?: string,            // when persisting
 *     persist?: boolean,
 *     limit?: number
 *   }
 */
export const POST = withAuth(async (request, { user }) => {
  try {
    const { query, profileUrl, jobId, persist = false, limit = 20 } = await request.json();
    if (!query && !profileUrl) {
      return NextResponse.json({ error: 'query or profileUrl is required' }, { status: 400 });
    }

    const [account] = await db
      .select()
      .from(rozeeAccounts)
      .where(and(eq(rozeeAccounts.userId, user.id), eq(rozeeAccounts.isActive, true)))
      .limit(1);

    const adapter = getAdapter('rozee');

    let scraped = [];
    if (profileUrl) {
      const result = await adapter.scrapeCandidate(account, profileUrl);
      if (!result.success) {
        return NextResponse.json({ error: result.error || 'Failed to scrape profile' }, { status: 500 });
      }
      scraped = [result.candidate];
    } else {
      const result = await adapter.searchCandidates(account, { query, limit });
      if (!result.success) {
        return NextResponse.json({ error: result.error || 'Failed to search Rozee' }, { status: 500 });
      }
      scraped = result.candidates || [];
    }

    let inserted = 0;
    if (persist && jobId && scraped.length) {
      const rows = scraped
        .filter((c) => c && (c.name || c.url))
        .map((c) => ({
          jobId,
          userId: user.id,
          name: c.name || 'Unknown',
          email: c.email || `unknown+${Date.now()}@rozee.local`,
          linkedinUrl: null,
          coverNote: null,
          resumeUrl: null,
          parsedData: {
            skills: c.skills || [],
            experience: c.experience || null,
            education: c.education || null,
          },
          source: 'rozee',
          sourceData: c,
          status: 'new',
        }));
      if (rows.length) {
        const result = await db.insert(candidatesTable).values(rows).returning({ id: candidatesTable.id });
        inserted = result.length;
      }
    }

    return NextResponse.json({
      success: true,
      count: scraped.length,
      inserted,
      candidates: scraped,
    });
  } catch (error) {
    console.error('Rozee candidates scrape error:', error);
    return NextResponse.json({ error: error.message || 'Failed to scrape Rozee candidates' }, { status: 500 });
  }
});
