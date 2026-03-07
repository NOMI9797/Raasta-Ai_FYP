import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/libs/next-auth';
import { db } from '@/libs/db';
import { workflowJobs, campaigns } from '@/libs/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { spawn } from 'child_process';
import getRedisClient from '@/libs/redis';


/**
 * POST /api/jobs/[jobId]/resume
 * Resume a paused workflow
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

    // Only allow resuming jobs that are paused
    if (job.status !== 'paused') {
      return NextResponse.json(
        { error: `Cannot resume job with status: ${job.status}` },
        { status: 400 }
      );
    }

    // Check if any other job for this user is already running
    const existingJob = await db.query.workflowJobs.findFirst({
      where: and(
        eq(workflowJobs.userId, session.user.id),
        inArray(workflowJobs.status, ['queued', 'processing'])
      )
    });

    if (existingJob) {
      const runningCampaign = await db.query.campaigns.findFirst({
        where: eq(campaigns.id, existingJob.campaignId)
      });

      return NextResponse.json({
        error: 'WORKFLOW_ALREADY_RUNNING',
        message: `Another workflow is already running for campaign "${runningCampaign?.name || 'Unknown'}". Please wait for it to complete.`,
        jobId: existingJob.id,
        campaignId: existingJob.campaignId,
        campaignName: runningCampaign?.name,
        status: existingJob.status
      }, { status: 409 });
    }

    console.log(`▶️  Resuming job: ${jobId.substring(0, 8)}... | Processed: ${job.processedLeads}/${job.totalLeads}`);

    // Update job status to queued (will be picked up by worker)
    const updatedJob = await db.update(workflowJobs)
      .set({
        status: 'queued',
        resumedAt: new Date()
      })
      .where(eq(workflowJobs.id, jobId))
      .returning();

    // Publish status update to Redis for SSE stream
    try {
      const redis = getRedisClient();
      const statusPayload = {
        type: 'status',
        jobId: updatedJob[0].id,
        campaignId: job.campaignId,
        status: 'queued',
        progress: updatedJob[0].progress || 0,
        totalLeads: updatedJob[0].totalLeads,
        processedLeads: updatedJob[0].processedLeads || 0,
        resumedAt: updatedJob[0].resumedAt,
        timestamp: Date.now()
      };
      await redis.publish(
        `job:${jobId}:status`,
        JSON.stringify(statusPayload)
      );
      await redis.setex(
        `job:${jobId}:status:last`,
        600,
        JSON.stringify(statusPayload)
      );
    } catch (redisError) {
      console.warn('⚠️  Redis publish failed:', redisError.message);
    }

    // Spawn worker process
    const workerPath = 'workers/workflow-worker.js';
    const worker = spawn('npx', ['tsx', workerPath, jobId], {
      detached: true,
      stdio: 'inherit'
    });

    worker.unref();

    console.log(`🔄 Worker spawned for resumed job | PID: ${worker.pid}`);

    return NextResponse.json({
      success: true,
      jobId: job.id,
      campaignId: job.campaignId,
      status: 'queued',
      resumedAt: new Date(),
      processedLeads: job.processedLeads,
      totalLeads: job.totalLeads,
      message: 'Workflow resumed successfully'
    });

  } catch (error) {
    console.error('❌ Error resuming job:', error);
    return NextResponse.json(
      { error: 'Failed to resume job', details: error.message },
      { status: 500 }
    );
  }
}

