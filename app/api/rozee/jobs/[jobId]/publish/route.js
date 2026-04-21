import { NextResponse } from 'next/server';
import { withAuth } from '@/libs/auth-middleware';
import { db } from '@/libs/db';
import { jobs, rozeeAccounts } from '@/libs/schema';
import { eq, and } from 'drizzle-orm';
import { getAdapter } from '@/libs/platforms';

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

    const [account] = await db
      .select()
      .from(rozeeAccounts)
      .where(and(eq(rozeeAccounts.userId, user.id), eq(rozeeAccounts.isActive, true)))
      .limit(1);
    if (!account) {
      return NextResponse.json(
        { error: 'No active Rozee account. Connect and activate a Rozee account first.' },
        { status: 400 }
      );
    }

    const adapter = getAdapter('rozee');
    const result = await adapter.publishJob(account, job);

    if (!result?.success) {
      const status = result?.error?.includes('Session invalid') ? 401 : 500;
      return NextResponse.json(
        { error: result?.error || 'Failed to publish to Rozee' },
        { status }
      );
    }

    await db
      .update(jobs)
      .set({
        rozeeAccountId: account.id,
        rozeePost: job.rozeePost || job.linkedinPost || null,
        rozeePostUrl: result.postUrl,
        rozeePublishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));

    return NextResponse.json({
      success: true,
      jobId,
      rozeePostUrl: result.postUrl,
    });
  } catch (error) {
    console.error('Rozee publish job error:', error);
    return NextResponse.json({ error: error.message || 'Failed to publish job' }, { status: 500 });
  }
});
