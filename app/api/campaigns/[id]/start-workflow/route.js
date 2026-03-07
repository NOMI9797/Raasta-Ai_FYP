/**
 * Start Background Workflow API
 * 
 * POST /api/campaigns/[id]/start-workflow
 * 
 * Creates a workflow job in the database and spawns a background worker
 * that continues running even if the user closes the browser.
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { db } from "@/libs/db";
import { workflowJobs, campaigns, linkedinAccounts } from "@/libs/schema";
import { eq, and, inArray } from "drizzle-orm";
import { spawn } from "child_process";
import path from "path";
import LinkedInSessionManager from "@/libs/linkedin-session";

const sessionManager = new LinkedInSessionManager();

export const POST = withAuth(async (request, { params, user }) => {
  try {
    const { id: campaignId } = params;
    const body = await request.json();
    const { customMessage } = body;
    
    console.log(`🚀 START WORKFLOW REQUEST: Campaign ${campaignId}`);
    
    // ============================================================
    // STEP 1: Validate Campaign
    // ============================================================
    console.log(`📋 STEP 1: Validating campaign...`);
    
    const campaign = await db.query.campaigns.findFirst({
      where: and(eq(campaigns.id, campaignId), eq(campaigns.userId, user.id))
    });
    
    if (!campaign) {
      console.error(`❌ Campaign ${campaignId} not found or unauthorized`);
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }
    
    console.log(`✅ Campaign validated: ${campaign.name}`);
    
    // ============================================================
    // STEP 2: Get Active LinkedIn Account
    // ============================================================
    console.log(`🔐 STEP 2: Finding active LinkedIn account...`);
    
    const allAccounts = await sessionManager.getAllSessions(user.id);
    const activeAccount = allAccounts.find(acc => acc.isActive);
    
    if (!activeAccount) {
      console.error(`❌ No active LinkedIn account found for user ${user.id}`);
      return NextResponse.json(
        { error: 'No active LinkedIn account found. Please connect a LinkedIn account first.' },
        { status: 400 }
      );
    }
    
    const accountId = activeAccount.id;
    console.log(`✅ Active account: ${activeAccount.email} (${accountId})`);
    
    // ============================================================
    // STEP 3: Check for Existing Running Job (One Job Per User)
    // ============================================================
    console.log(`🔍 STEP 3: Checking for existing running job (any campaign)...`);
    
    // Check if user has ANY running job (not just for this campaign)
    const existingJob = await db.query.workflowJobs.findFirst({
      where: and(
        eq(workflowJobs.userId, user.id),
        inArray(workflowJobs.status, ['queued', 'processing'])
      )
    });
    
    if (existingJob) {
      console.log(`⚠️  User already has a running job: ${existingJob.id}`);
      console.log(`⚠️  Job campaign: ${existingJob.campaignId}, status: ${existingJob.status}`);
      
      // Get campaign name for better user message
      const runningCampaign = await db.query.campaigns.findFirst({
        where: eq(campaigns.id, existingJob.campaignId)
      });
      
      const isSameCampaign = existingJob.campaignId === campaignId;
      
      return NextResponse.json({
        error: 'WORKFLOW_ALREADY_RUNNING',
        message: isSameCampaign 
          ? 'A workflow is already running for this campaign'
          : `Another workflow is already running for campaign "${runningCampaign?.name || 'Unknown'}". Please wait for it to complete.`,
        jobId: existingJob.id,
        campaignId: existingJob.campaignId,
        campaignName: runningCampaign?.name,
        status: existingJob.status,
        progress: existingJob.progress || 0,
        processedLeads: existingJob.processedLeads || 0,
        totalLeads: existingJob.totalLeads || 0,
        isSameCampaign
      }, { status: 409 });
    }
    
    console.log(`✅ No existing job found, creating new job...`);
    
    // ============================================================
    // STEP 4: Create Workflow Job
    // ============================================================
    console.log(`💾 STEP 4: Creating workflow job in database...`);
    
    const [job] = await db.insert(workflowJobs).values({
      campaignId,
      userId: user.id,
      accountId,
      customMessage: customMessage || "Hi! I'd like to connect with you.",
      status: 'queued'
    }).returning();
    
    console.log(`✅ Job created: ${job.id}`);
    
    // ============================================================
    // STEP 4: Spawn Background Worker
    // ============================================================
    console.log(`🔄 STEP 4: Spawning background worker...`);
    
    const workerPath = path.join(process.cwd(), 'workers', 'workflow-worker.js');
    
    console.log(`📂 Worker path: ${workerPath}`);
    console.log(`📋 Worker command: npx tsx ${workerPath} ${job.id}`);
    
    const worker = spawn('npx', ['tsx', workerPath, job.id], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Ensure worker has access to all environment variables
        NODE_ENV: process.env.NODE_ENV,
        DATABASE_URL: process.env.DATABASE_URL,
        REDIS_URL: process.env.REDIS_URL
      },
      cwd: process.cwd()
    });
    
    // Log worker output for debugging (non-blocking)
    worker.stdout.on('data', (data) => {
      const output = data.toString().trim();
      console.log(`[Worker ${job.id}] ${output}`);
    });
    
    worker.stderr.on('data', (data) => {
      const error = data.toString().trim();
      console.error(`[Worker ${job.id} ERROR] ${error}`);
    });
    
    worker.on('exit', (code) => {
      console.log(`[Worker ${job.id}] Exited with code ${code}`);
    });
    
    worker.on('error', (error) => {
      console.error(`[Worker ${job.id}] Spawn error:`, error);
    });
    
    // Detach worker so it continues running after API response
    worker.unref();
    
    console.log(`✅ Worker spawned: PID ${worker.pid}`);
    
    // ============================================================
    // STEP 5: Return Response (Immediately)
    // ============================================================
    console.log(`✅ Workflow started successfully`);
    console.log(`📊 Job ID: ${job.id}`);
    console.log(`📊 Status URL: /api/jobs/${job.id}/status`);
    
    return NextResponse.json({
      success: true,
      jobId: job.id,
      campaignId: campaign.id,
      campaignName: campaign.name,
      status: 'queued',
      message: 'Workflow started in background. You can close this page safely.',
      details: 'The workflow will continue running on the server. Poll /api/jobs/{jobId}/status to check progress.',
      statusUrl: `/api/jobs/${job.id}/status`,
      createdAt: job.createdAt
    });
    
  } catch (error) {
    console.error('❌ Start workflow error:', error);
    console.error('❌ Stack:', error.stack);
    
    return NextResponse.json(
      { 
        error: 'Failed to start workflow', 
        message: error.message,
        details: error.stack
      },
      { status: 500 }
    );
  }
});

