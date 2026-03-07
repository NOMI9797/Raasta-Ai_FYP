import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/libs/next-auth';
import { db } from '@/libs/db';
import { workflowJobs } from '@/libs/schema';
import { eq, and } from 'drizzle-orm';
import getRedisClient from '@/libs/redis';

/**
 * POST /api/jobs/[jobId]/cancel
 * Permanently cancel a workflow (cannot be resumed)
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

    // Only allow cancelling jobs that are processing or paused
    if (!['processing', 'paused', 'queued'].includes(job.status)) {
      return NextResponse.json(
        { error: `Cannot cancel job with status: ${job.status}` },
        { status: 400 }
      );
    }

    // Update job status to cancelled
    const updatedJob = await db.update(workflowJobs)
      .set({
        status: 'cancelled',
        completedAt: new Date(),
        errorMessage: 'Cancelled by user'
      })
      .where(eq(workflowJobs.id, jobId))
      .returning();

    console.log(`🛑 Job cancelled: ${jobId.substring(0, 8)}... | Progress: ${job.processedLeads}/${job.totalLeads}`);

    // Publish to Redis for instant worker notification and SSE updates
    try {
      const redis = getRedisClient();
      const statusPayload = {
        type: 'status',
        jobId: updatedJob[0].id,
        campaignId: job.campaignId,
        status: 'cancelled',
        progress: updatedJob[0].progress || 0,
        totalLeads: updatedJob[0].totalLeads,
        processedLeads: updatedJob[0].processedLeads || 0,
        errorMessage: 'Cancelled by user',
        completedAt: updatedJob[0].completedAt,
        timestamp: Date.now()
      };
      
      // Publish control signal for worker
      await redis.publish(
        `job:${jobId}:control`,
        JSON.stringify({
          action: 'cancel',
          timestamp: new Date().toISOString(),
          userId: session.user.id
        })
      );
      
      // Publish status update for SSE stream
      await redis.publish(
        `job:${jobId}:status`,
        JSON.stringify(statusPayload)
      );
      
      await redis.setex(
        `job:${jobId}:status:last`,
        600,
        JSON.stringify(statusPayload)
      );
      
      console.log(`📢 Published CANCEL signal to Redis | Job: ${jobId.substring(0, 8)}...`);
    } catch (redisError) {
      console.error('⚠️  Redis publish failed (worker will use DB fallback):', redisError.message);
      // Don't fail the request - worker has DB fallback
    }

    return NextResponse.json({
      success: true,
      jobId: updatedJob[0].id,
      status: updatedJob[0].status,
      completedAt: updatedJob[0].completedAt,
      processedLeads: updatedJob[0].processedLeads,
      totalLeads: updatedJob[0].totalLeads,
      message: 'Workflow cancelled successfully'
    });

  } catch (error) {
    console.error('❌ Error cancelling job:', error);
    return NextResponse.json(
      { error: 'Failed to cancel job', details: error.message },
      { status: 500 }
    );
  }
}

