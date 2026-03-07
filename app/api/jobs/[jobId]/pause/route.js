import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/libs/next-auth';
import { db } from '@/libs/db';
import { workflowJobs } from '@/libs/schema';
import { eq, and, sql } from 'drizzle-orm';
import getRedisClient from '@/libs/redis';

/**
 * POST /api/jobs/[jobId]/pause
 * Pause a running workflow
 */
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { jobId } = params;

    // Find the job and verify ownership
    const job = await db.query.workflowJobs.findFirst({
      where: and(
        eq(workflowJobs.id, jobId),
        eq(workflowJobs.userId, session.user.id)
      )
    });

    if (!job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    // Only allow pausing jobs that are currently processing
    if (job.status !== 'processing') {
      return NextResponse.json(
        { error: `Cannot pause job with status: ${job.status}` },
        { status: 400 }
      );
    }

    // Update job status to paused
    const updatedJob = await db.update(workflowJobs)
      .set({
        status: 'paused',
        pausedAt: new Date(),
        pauseCount: sql`${workflowJobs.pauseCount} + 1`
      })
      .where(eq(workflowJobs.id, jobId))
      .returning();

    console.log(`⏸️  Job paused: ${jobId.substring(0, 8)}... | Pause count: ${updatedJob[0].pauseCount}`);

    // Publish to Redis for instant worker notification and SSE updates
    try {
      const redis = getRedisClient();
      const statusPayload = {
        type: 'status',
        jobId: updatedJob[0].id,
        campaignId: job.campaignId,
        status: 'paused',
        progress: updatedJob[0].progress || 0,
        totalLeads: updatedJob[0].totalLeads,
        processedLeads: updatedJob[0].processedLeads || 0,
        pausedAt: updatedJob[0].pausedAt,
        pauseCount: updatedJob[0].pauseCount,
        timestamp: Date.now()
      };
      
      // Publish control signal for worker
      await redis.publish(
        `job:${jobId}:control`,
        JSON.stringify({
          action: 'pause',
          timestamp: new Date().toISOString(),
          userId: session.user.id,
          pauseCount: updatedJob[0].pauseCount
        })
      );
      
      // Publish status update for SSE stream
      await redis.publish(
        `job:${jobId}:status`,
        JSON.stringify(statusPayload)
      );
      
      // Persist snapshot for reconnects
      await redis.setex(
        `job:${jobId}:status:last`,
        600,
        JSON.stringify(statusPayload)
      );
      
      console.log(`📢 Published PAUSE signal to Redis | Job: ${jobId.substring(0, 8)}... | Count: ${updatedJob[0].pauseCount}`);
    } catch (redisError) {
      console.error('⚠️  Redis publish failed (worker will use DB fallback):', redisError.message);
      // Don't fail the request - worker has DB fallback
    }

    return NextResponse.json({
      success: true,
      jobId: updatedJob[0].id,
      status: updatedJob[0].status,
      pausedAt: updatedJob[0].pausedAt,
      pauseCount: updatedJob[0].pauseCount,
      processedLeads: updatedJob[0].processedLeads,
      totalLeads: updatedJob[0].totalLeads
    });

  } catch (error) {
    console.error('❌ Error pausing job:', error);
    return NextResponse.json(
      { error: 'Failed to pause job', details: error.message },
      { status: 500 }
    );
  }
}

