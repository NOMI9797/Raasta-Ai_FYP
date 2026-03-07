import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/libs/next-auth';
import { db } from '@/libs/db';
import { workflowJobs } from '@/libs/schema';
import { eq, and, inArray, desc } from 'drizzle-orm';

/**
 * GET /api/campaigns/[id]/active-job
 * Get any active (queued, processing, or paused) job for this campaign
 */
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id: campaignId } = params;

    // Find any active job for this campaign
    const job = await db.query.workflowJobs.findFirst({
      where: and(
        eq(workflowJobs.campaignId, campaignId),
        eq(workflowJobs.userId, session.user.id),
        inArray(workflowJobs.status, ['queued', 'processing', 'paused'])
      ),
      orderBy: [desc(workflowJobs.createdAt)]
    });

    if (!job) {
      return NextResponse.json({ job: null });
    }

    console.log(`📋 Active job found for campaign ${campaignId.substring(0, 8)}... | Job: ${job.id.substring(0, 8)}... | Status: ${job.status}`);

    return NextResponse.json({ 
      job: {
        id: job.id,
        campaignId: job.campaignId,
        status: job.status,
        processedLeads: job.processedLeads,
        totalLeads: job.totalLeads,
        progress: job.progress,
        results: job.results,
        errorMessage: job.errorMessage,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        pausedAt: job.pausedAt
      }
    });

  } catch (error) {
    console.error('❌ Error fetching active job:', error);
    return NextResponse.json(
      { error: 'Failed to fetch active job', details: error.message },
      { status: 500 }
    );
  }
}

