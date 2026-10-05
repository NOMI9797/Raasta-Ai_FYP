import { NextResponse } from 'next/server';
import { withAuth } from '@/libs/auth-middleware';
import { db } from '@/libs/db';
import { jobs } from '@/libs/schema';
import { eq, and } from 'drizzle-orm';
import { publishToPlatform } from '@/libs/hiring/publishing';

// Kept for older callers. Publishing now goes through libs/hiring/publishing.js (posting limits,
// one attempt at a time, a record of every attempt); new code uses POST /api/hiring/jobs/[jobId]/publish.
const REFUSAL_STATUS = { not_connected: 400, invalid_post: 400, closed: 400, in_progress: 409, daily_limit: 429, too_soon: 429, needs_login: 401 };

export const POST = withAuth(async (request, { user, params }) => {
  try {
    const { jobId } = params;
    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    }

    const [job] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.userId, user.id)))
      .limit(1);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const result = await publishToPlatform({ job, platform: 'rozee' });
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: REFUSAL_STATUS[result.code] || 500 });
    }
    return NextResponse.json({ success: true, jobId, rozeePostUrl: result.postUrl });
  } catch (error) {
    console.error('Rozee publish job error:', error.message);
    return NextResponse.json({ error: 'Failed to publish job' }, { status: 500 });
  }
});
