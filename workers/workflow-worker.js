/**
 * Background Workflow Worker
 * 
 * On-demand worker that processes LinkedIn invite workflows in the background.
 * Spawned by the API when a workflow is started, exits when done.
 * 
 * Usage: node workers/workflow-worker.js <jobId>
 */

import { testLinkedInSession, cleanupBrowserSession } from '../libs/linkedin-session-validator';
import { processInvitesDirectly } from '../libs/linkedin-invite-automation';
import { fetchEligibleLeads } from '../libs/lead-status-manager';
import { checkDailyLimit, incrementDailyCounter } from '../libs/rate-limit-manager';
import { db } from '../libs/db';
import { workflowJobs, linkedinAccounts } from '../libs/schema';
import { eq } from 'drizzle-orm';
import { createClient } from 'redis';

// Global Redis subscriber for event-driven job control
let redisSubscriber = null;
// Global Redis publisher for progress updates
let redisPublisher = null;

const jobId = process.argv[2];

if (!jobId) {
  console.error('❌ ERROR: Job ID required');
  console.error('Usage: node workers/workflow-worker.js <jobId>');
  process.exit(1);
}

console.log(`🚀 Worker Started | Job: ${jobId.substring(0, 8)}... | PID: ${process.pid}`);

/**
 * Setup Redis Pub/Sub listener for instant job control
 * Subscribes to job:{jobId}:control channel for pause/cancel signals
 */
async function setupControlListener(jobId) {
  try {
    // Create dedicated subscriber client
    redisSubscriber = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });

    // Handle connection errors
    redisSubscriber.on('error', (err) => {
      console.error('⚠️  Redis Subscriber Error:', err.message);
      // Don't crash - we have DB fallback
    });

    await redisSubscriber.connect();
    
    const channel = `job:${jobId}:control`;
    
    // Subscribe to control channel
    await redisSubscriber.subscribe(channel, async (message) => {
      try {
        const data = JSON.parse(message);
        const timestamp = new Date().toISOString();
        const latency = Date.now() - new Date(data.timestamp).getTime();
        
        console.log(`\n📡 [${timestamp}] Redis Signal Received`);
        console.log(`   Action: ${data.action.toUpperCase()}`);
        console.log(`   Job: ${jobId.substring(0, 8)}...`);
        console.log(`   Source: ${data.userId || 'unknown'}`);
        console.log(`   Latency: ~${latency}ms`);
        
        if (data.action === 'cancel' || data.action === 'pause') {
          const actionName = data.action.toUpperCase();
          console.log(`🛑 [CONTROL] ${actionName} signal received - EXITING IMMEDIATELY`);
          console.log(`   Event-driven exit via Redis Pub/Sub`);
          
          // Cleanup Redis connection
          await cleanupRedisSubscriber();
          
          // Exit immediately - truly event-driven!
          console.log(`👋 Exit: 0 (${data.action})`);
          process.exit(0);
        }
      } catch (parseError) {
        console.error('❌ Failed to parse Redis message:', parseError.message);
      }
    });
    
    console.log(`📡 Subscribed to control channel: ${channel}`);
    return true;
    
  } catch (error) {
    console.error('⚠️  Redis subscription failed:', error.message);
    console.log('⚠️  Falling back to DB polling for control signals');
    return false;
  }
}

/**
 * Setup Redis publisher for progress updates
 */
async function setupProgressPublisher(jobId) {
  try {
    redisPublisher = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });

    redisPublisher.on('error', (err) => {
      console.error('⚠️  Redis Publisher Error:', err.message);
    });

    await redisPublisher.connect();
    console.log(`📡 Redis publisher connected for job ${jobId.substring(0, 8)}...`);
    return true;
  } catch (error) {
    console.error('⚠️  Redis publisher setup failed:', error.message);
    return false;
  }
}

/**
 * Publish progress update to Redis Pub/Sub
 */
async function publishProgress(jobId, data) {
  if (!redisPublisher) return;
  
  try {
    const channel = `job:${jobId}:status`;
    const payload = {
      ...data,
      timestamp: Date.now()
    };
    await redisPublisher.publish(channel, JSON.stringify(payload));

    const snapshotKey = `job:${jobId}:status:last`;
    await redisPublisher.set(snapshotKey, JSON.stringify(payload), {
      EX: 600 // cache last status for 10 minutes
    });
  } catch (error) {
    console.warn('⚠️  Failed to publish progress to Redis:', error.message);
    // Don't fail the workflow if Redis publish fails
  }
}

/**
 * Cleanup Redis subscriber connection
 */
async function cleanupRedisSubscriber() {
  if (redisSubscriber) {
    try {
      await redisSubscriber.quit();
      console.log('🔌 Redis subscriber disconnected');
    } catch (error) {
      console.error('⚠️  Error disconnecting Redis subscriber:', error.message);
    }
  }
}

/**
 * Cleanup Redis publisher connection
 */
async function cleanupRedisPublisher() {
  if (redisPublisher) {
    try {
      await redisPublisher.quit();
      console.log('🔌 Redis publisher disconnected');
    } catch (error) {
      console.error('⚠️  Error disconnecting Redis publisher:', error.message);
    }
  }
}

// Handle process termination signals
process.on('SIGTERM', async () => {
  console.log('\n🛑 SIGTERM received - shutting down gracefully...');
  await cleanupRedisSubscriber();
  await cleanupRedisPublisher();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n🛑 SIGINT received - shutting down gracefully...');
  await cleanupRedisSubscriber();
  await cleanupRedisPublisher();
  process.exit(0);
});

async function runJob() {
  let useRedisControl = false;
  try {
    // Fetch Job from Database
    const job = await db.query.workflowJobs.findFirst({
      where: eq(workflowJobs.id, jobId)
    });
    
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }
    
    console.log(`📋 Campaign: ${job.campaignId.substring(0, 8)}... | Status: processing`);
    
    // Update job status to processing
    await db.update(workflowJobs)
      .set({ status: 'processing', startedAt: new Date() })
      .where(eq(workflowJobs.id, jobId));
    
    // Setup Redis control listener for instant pause/cancel
    console.log('📡 Setting up real-time control listener...');
    useRedisControl = await setupControlListener(jobId);
    
    if (useRedisControl) {
      console.log('✅ Real-time control: ENABLED (Redis Pub/Sub)');
    } else {
      console.log('⚠️  Real-time control: DISABLED (using DB fallback)');
    }
    
    // Setup Redis publisher for progress updates
    console.log('📡 Setting up progress publisher...');
    const publisherEnabled = await setupProgressPublisher(jobId);
    
    if (publisherEnabled) {
      console.log('✅ Progress publisher: ENABLED (Redis Pub/Sub)');
      
      // Publish initial "processing" status
      await publishProgress(jobId, {
        type: 'status',
        jobId: jobId,
        campaignId: job.campaignId,
        status: 'processing',
        progress: 0,
        totalLeads: null, // Will be set when leads are fetched
        processedLeads: job.processedLeads || 0,
        startedAt: new Date().toISOString()
      });
    } else {
      console.log('⚠️  Progress publisher: DISABLED (updates will only go to DB)');
    }
    
    // Get LinkedIn Account Data
    const accountData = await db.query.linkedinAccounts.findFirst({
      where: eq(linkedinAccounts.id, job.accountId)
    });
    
    if (!accountData) {
      throw new Error('LinkedIn account not found');
    }
    
    // Check Daily Limit
    const quotas = await checkDailyLimit(job.accountId);
    console.log(`📊 Account: ${accountData.email} | Quota: ${quotas.sent}/${quotas.limit} (${quotas.remaining} left)`);
    
    if (!quotas.canSend) {
      const resetsIn = Math.ceil((quotas.resetsAt - new Date()) / (1000 * 60 * 60));
      throw new Error(`Daily limit reached (${quotas.limit}). Resets in ${resetsIn} hours.`);
    }
    
    // Fetch Eligible Leads
    const { eligibleLeads, source } = await fetchEligibleLeads(job.campaignId);
    console.log(`📥 Leads: ${eligibleLeads.length} eligible (from ${source})`);
    
    if (eligibleLeads.length === 0) {
      console.log(`ℹ️  No action needed - all leads already processed`);
      
      const skippedResults = {
        total: 0,
        sent: 0,
        alreadyConnected: 0,
        alreadyPending: 0,
        failed: 0,
        skipped: true,
        skipReason: 'all_leads_already_processed',
        message: '✅ All leads in this campaign already have pending or accepted invites.'
      };
      
      // Mark job as completed (not failed) - this is a successful no-op
      await db.update(workflowJobs)
        .set({
          status: 'completed',
          completedAt: new Date(),
          totalLeads: 0,
          processedLeads: 0,
          progress: 100,
          results: skippedResults
        })
        .where(eq(workflowJobs.id, jobId));
      
      // Publish completion to Redis so SSE clients can finish gracefully
      await publishProgress(jobId, {
        type: 'status',
        jobId,
        campaignId: job.campaignId,
        status: 'completed',
        stage: 'completed',
        progress: 100,
        totalLeads: 0,
        processedLeads: 0,
        results: skippedResults,
        completedAt: new Date().toISOString()
      });
      
      await cleanupRedisPublisher();
      
      console.log(`✅ Job Completed (skipped) | Exit: 0`);
      process.exit(0);
    }
    
    // Limit to remaining quota
    const leadsToProcess = eligibleLeads.slice(0, Math.min(eligibleLeads.length, quotas.remaining));
    
    if (leadsToProcess.length < eligibleLeads.length) {
      console.log(`⚠️ Limited to ${leadsToProcess.length} leads (daily quota: ${quotas.remaining})`);
    }
    
    // Split into Batches
    const BATCH_SIZE = 10;
    const batches = [];
    for (let i = 0; i < leadsToProcess.length; i += BATCH_SIZE) {
      batches.push(leadsToProcess.slice(i, i + BATCH_SIZE));
    }
    
    console.log(`📦 Batches: ${batches.length} × ${BATCH_SIZE} leads`);
    
    // Check if this is a resume (processedLeads > 0)
    const isResume = job.processedLeads > 0;
    if (isResume) {
      console.log(`🔄 Resuming from lead ${job.processedLeads + 1}/${leadsToProcess.length}`);
    }
    
    // Update total leads in job
    await db.update(workflowJobs)
      .set({ totalLeads: leadsToProcess.length })
      .where(eq(workflowJobs.id, jobId));
    
    // Process Each Batch Sequentially
    if (isResume) {
      console.log(`🔄 Resuming workflow | Previously processed: ${job.processedLeads} | Eligible now: ${leadsToProcess.length}`);
    }
    console.log(`🔄 Starting batch processing...`);
    
    let totalSent = 0;
    let totalFailed = 0;
    let totalAlreadyConnected = 0;
    let totalAlreadyPending = 0;
    let currentLeadIndex = 0; // Always start from 0 with filtered eligible leads
    
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      let batchContext = null;
      
      console.log(`\n📦 Batch ${batchIndex + 1}/${batches.length} | ${batch.length} leads`);
      
      try {
        // Validate Session (Open Browser)
        const sessionResult = await testLinkedInSession(accountData, true);
        
        if (!sessionResult.isValid) {
          throw new Error(`Session invalid: ${sessionResult.reason}`);
        }
        
        console.log(`  ✅ Session validated`);
        
        batchContext = sessionResult.context;
        const batchPage = sessionResult.page;
        
        // Process Invites with Progress Callback
        // Progress callback to update database and publish to Redis in real-time
        const progressCallback = async (progressData) => {
          if (progressData.type === 'progress') {
            // Handle fractional progress (e.g., 0.5 means 50% through current lead)
            const fractionalProgress = progressData.current || 0;
            const totalLeads = leadsToProcess.length;
            
            // Calculate actual progress: if we're at lead 2.5, that means 2.5/10 = 25% complete
            const actualProgress = Math.min(Math.round((fractionalProgress / totalLeads) * 100), 100);
            const processedLeads = Math.floor(fractionalProgress); // Integer part (completed leads)
            const currentLead = Math.ceil(fractionalProgress); // Current lead being processed (1-indexed)
            
            // Only update currentLeadIndex when we complete a lead (fractionalProgress is whole number)
            if (fractionalProgress % 1 === 0 && fractionalProgress > currentLeadIndex) {
              currentLeadIndex = fractionalProgress;
            }
            
            try {
              // ✅ REDIS-FIRST: Publish progress to Redis Pub/Sub (instant updates)
              await publishProgress(jobId, {
                type: 'status',
                jobId: jobId,
                campaignId: job.campaignId,
                status: 'processing',
                progress: actualProgress,
                totalLeads: totalLeads,
                processedLeads: processedLeads,
                currentLead: currentLead, // Current lead number (for smoother progress bar)
                fractionalProgress: fractionalProgress, // For precise progress calculation
                stage: progressData.stage || 'processing', // e.g., 'navigating', 'clicking', 'sending'
                timestamp: Date.now()
              });
              
              // ✅ DB: Update progress in database (only on whole number progress to reduce DB writes)
              // Update DB less frequently to reduce load, but still update Redis for smooth UI
              if (fractionalProgress % 1 === 0) {
                await db.update(workflowJobs)
                  .set({
                    processedLeads: processedLeads,
                    progress: actualProgress
                  })
                  .where(eq(workflowJobs.id, jobId));
              }
              
              // Only log major milestones to reduce console noise
              if (fractionalProgress % 1 === 0 || progressData.stage === 'sending') {
                console.log(`  📊 Progress: ${processedLeads}/${totalLeads} (${actualProgress}%)${progressData.stage ? ` - ${progressData.stage}` : ''}`);
              }
              
              // 🔥 Increment daily counter immediately for successfully sent invites
              if (progressData.status === 'sent') {
                await incrementDailyCounter(job.accountId, 1);
                console.log(`  📊 Daily counter incremented (+1)`);
              }
              
              // 🔥 FALLBACK: Check for pause/cancel after every lead if Redis is unavailable
              if (!useRedisControl && fractionalProgress % 1 === 0) {
                const currentJob = await db.query.workflowJobs.findFirst({
                  where: eq(workflowJobs.id, jobId),
                  columns: { status: true }  // Only fetch status column (optimization)
                });
                
                if (currentJob && (currentJob.status === 'paused' || currentJob.status === 'cancelled')) {
                  console.log(`🛑 [FALLBACK] Job ${currentJob.status} detected during lead processing`);
                  console.log(`   Exiting after lead ${processedLeads}/${totalLeads}`);
                  
                  // Throw error to break out of invite processing loop
                  throw new Error(`WORKFLOW_${currentJob.status.toUpperCase()}`);
                }
              }
              
            } catch (dbError) {
              // Re-throw workflow control errors (pause/cancel)
              if (dbError.message && dbError.message.startsWith('WORKFLOW_')) {
                throw dbError;
              }
              // Log other DB errors but don't stop workflow
              console.error(`  ❌ DB update failed:`, dbError.message);
            }
          }
        };
        
        // Process invites (reuses existing automation logic)
        try {
          const batchResults = await processInvitesDirectly(
            batchContext,
            batchPage,
            batch,
            job.customMessage || "Hi! I'd like to connect with you.",
            job.campaignId,
            progressCallback
          );
          
          // Aggregate results
          totalSent += batchResults.sent;
          totalFailed += batchResults.failed;
          totalAlreadyConnected += batchResults.alreadyConnected;
          totalAlreadyPending += batchResults.alreadyPending;
          
          console.log(`  ✅ Sent: ${batchResults.sent} | Failed: ${batchResults.failed}`);
          
          // Note: Daily counter is now incremented per-lead in progressCallback (above)
          // This ensures accurate tracking even if batch is interrupted by pause/cancel
          
        } catch (processError) {
          // Handle workflow control signals (pause/cancel via DB fallback)
          if (processError.message === 'WORKFLOW_PAUSED' || processError.message === 'WORKFLOW_CANCELLED') {
            const action = processError.message.replace('WORKFLOW_', '').toLowerCase();
            console.log(`🛑 Workflow ${action} - cleaning up and exiting`);
            
            // Close browser gracefully
            if (batchContext) {
              console.log('🔒 Closing browser before exit...');
              await cleanupBrowserSession(batchContext);
            }
            
            // Cleanup Redis
            await cleanupRedisSubscriber();
            
            console.log(`👋 Exit: 0 (${action})`);
            process.exit(0);
          }
          
          // Other processing errors - re-throw to batch error handler
          throw processError;
        }
        
      } catch (batchError) {
        console.error(`  ❌ Batch error: ${batchError.message}`);
        totalFailed += batch.length;
        
      } finally {
        // Close Browser
        if (batchContext) {
          await cleanupBrowserSession(batchContext);
          console.log(`  🔒 Browser closed`);
        }
      }
      
      // ============================================================
      // BATCH STEP 4: Check Daily Limit
      // ============================================================
      const updatedQuotas = await checkDailyLimit(job.accountId);
      
      if (!updatedQuotas.canSend) {
        console.log(`⚠️  Limit reached after batch ${batchIndex + 1}/${batches.length}`);
        break;
      }
      
      // Delay Before Next Batch (if not last)
      if (batchIndex < batches.length - 1) {
        const delayMinutes = 5;
        const delayMs = delayMinutes * 60 * 1000;
        const nextTime = new Date(Date.now() + delayMs).toLocaleTimeString();
        
        console.log(`⏱️  Waiting ${delayMinutes}min (next at ${nextTime})...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    // Update Job Status to Completed
    console.log(`\n✅ Workflow Complete | Sent: ${totalSent} | Failed: ${totalFailed} | Already: ${totalAlreadyConnected + totalAlreadyPending}`);
    
    // ✅ REDIS-FIRST: Publish completion to Redis
    await publishProgress(jobId, {
      type: 'status',
      jobId: jobId,
      campaignId: job.campaignId,
      status: 'completed',
      progress: 100,
      totalLeads: leadsToProcess.length,
      processedLeads: currentLeadIndex,
      results: {
        total: leadsToProcess.length,
        sent: totalSent,
        failed: totalFailed,
        alreadyConnected: totalAlreadyConnected,
        alreadyPending: totalAlreadyPending
      },
      completedAt: new Date().toISOString()
    });
    
    // ✅ DB: Update job status in database
    await db.update(workflowJobs)
      .set({
        status: 'completed',
        completedAt: new Date(),
        processedLeads: currentLeadIndex,
        results: {
          total: leadsToProcess.length,
          sent: totalSent,
          failed: totalFailed,
          alreadyConnected: totalAlreadyConnected,
          alreadyPending: totalAlreadyPending
        },
        progress: 100
      })
      .where(eq(workflowJobs.id, jobId));
    
    // Cleanup Redis connections
    await cleanupRedisPublisher();
    
    console.log(`👋 Exit: 0\n`);
    process.exit(0);
    
  } catch (error) {
    console.error(`\n❌ Job Failed | Error: ${error.message}`);
    
    // ✅ REDIS-FIRST: Publish failure to Redis
    await publishProgress(jobId, {
      type: 'status',
      jobId: jobId,
      campaignId: job?.campaignId,
      status: 'failed',
      errorMessage: error.message,
      completedAt: new Date().toISOString()
    });
    
    // ✅ DB: Update job status to failed
    await db.update(workflowJobs)
      .set({
        status: 'failed',
        completedAt: new Date(),
        errorMessage: error.message
      })
      .where(eq(workflowJobs.id, jobId));
    
    // Cleanup Redis connections
    await cleanupRedisPublisher();
    
    console.log(`👋 Exit: 1\n`);
    process.exit(1);
    
  } finally {
    // Always cleanup Redis connections
    await cleanupRedisSubscriber();
    await cleanupRedisPublisher();
  }
}

// Run the job
runJob();

