/**
 * Job Status API
 * 
 * GET /api/jobs/[jobId]/status
 * 
 * Returns the current status of a background workflow job.
 * Used by the frontend for polling progress updates.
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { db } from "@/libs/db";
import { workflowJobs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";

export const GET = withAuth(async (request, { params, user }) => {
  try {
    const { jobId } = params;
    
    // Fetch job from database
    const job = await db.query.workflowJobs.findFirst({
      where: and(
        eq(workflowJobs.id, jobId),
        eq(workflowJobs.userId, user.id)
      )
    });
    
    if (!job) {
      console.error(`❌ Job ${jobId} not found or unauthorized`);
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    
    console.log(`✅ Job found: ${job.status} (${job.progress}%)`);
    
    // ============================================================
    // Timeout Detection: Check if job has been processing too long
    // ============================================================
    const TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours
    
    if (job.status === 'processing' && job.startedAt) {
      const jobAge = Date.now() - new Date(job.startedAt).getTime();
      
      if (jobAge > TIMEOUT_MS) {
        console.log(`⏱️  Job ${jobId} has been processing for ${Math.round(jobAge / 60000)} minutes (timeout: ${TIMEOUT_MS / 60000} min)`);
        console.log(`⚠️  Marking job as timeout...`);
        
        // Update job status to timeout
        await db.update(workflowJobs)
          .set({
            status: 'timeout',
            errorMessage: `Job exceeded ${TIMEOUT_MS / 60000} minute timeout. Worker may have crashed.`,
            completedAt: new Date()
          })
          .where(eq(workflowJobs.id, jobId));
        
        // Return updated status
        return NextResponse.json({
          jobId: job.id,
          campaignId: job.campaignId,
          status: 'timeout',
          progress: job.progress || 0,
          totalLeads: job.totalLeads,
          processedLeads: job.processedLeads || 0,
          results: job.results,
          errorMessage: `Job exceeded ${TIMEOUT_MS / 60000} minute timeout. Worker may have crashed.`,
          createdAt: job.createdAt,
          startedAt: job.startedAt,
          completedAt: new Date()
        });
      }
    }
    
    // Return job status
    return NextResponse.json({
      jobId: job.id,
      campaignId: job.campaignId,
      status: job.status,
      progress: job.progress || 0,
      totalLeads: job.totalLeads,
      processedLeads: job.processedLeads || 0,
      results: job.results,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt
    });
    
  } catch (error) {
    console.error('❌ Get job status error:', error);
    console.error('❌ Stack:', error.stack);
    
    return NextResponse.json(
      { 
        error: 'Failed to get job status',
        message: error.message
      },
      { status: 500 }
    );
  }
});

