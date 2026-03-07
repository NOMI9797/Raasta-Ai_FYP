import { NextResponse } from "next/server";
import { RedisStreamManager } from "@/libs/redis";
import { db } from "@/libs/db";
import { leads } from "@/libs/schema";
import { eq, inArray } from "drizzle-orm";
import getRedisClient from "@/libs/redis";
import { withAuth } from "@/libs/auth-middleware";
import { LinkedInInviteService } from "@/libs/linkedin-invite-service";

/**
 * POST /api/redis-workflow/workers/invite-sender
 * 
 * Batch Processing: Invite Sending Worker
 * 
 * This worker:
 * 1. Consumes batches from Redis stream
 * 2. Processes 5 leads per batch
 * 3. Updates invite status in Redis and database
 * 4. Handles rate limiting and delays
 */
export const POST = async (request) => {
  let lockValue = null;
  let LOCK_KEY = null; // Define outside try block for finally access
  let campaignId = null; // Define outside try block for finally access
  
  try {
    // Check if this is an internal call (bypasses auth)
    const isInternalCall = request.headers.get('x-internal-call') === 'true';
    const internalUserId = request.headers.get('x-user-id');
    
    console.log(`🟢 INVITE-SENDER WORKER HIT: Internal: ${isInternalCall}, User: ${internalUserId}`);
    
    // Get campaign ID from request body
    const requestBody = await request.json();
    campaignId = requestBody.campaignId;
    
    if (!campaignId) {
      return NextResponse.json({
        success: false,
        message: "Campaign ID is required",
        data: { batchesProcessed: 0 }
      }, { status: 400 });
    }

    const streamManager = new RedisStreamManager();
    const redis = getRedisClient();
    
    // Campaign-specific stream and lock
    const STREAM_NAME = `campaign:${campaignId}:invite-sending`;
    LOCK_KEY = `batch-processing:campaign:${campaignId}`; // Assign to outer variable
    const CONSUMER_GROUP_NAME = "invite-senders";
    const CONSUMER_NAME = `worker-${Date.now()}`;

    // Check if batch processing is already locked for this campaign
    const isLocked = await streamManager.isBatchLocked(LOCK_KEY);
    if (isLocked) {
      return NextResponse.json({
        success: false,
        message: "Batch processing is already in progress for this campaign",
        data: { batchesProcessed: 0 }
      });
    }

    // Acquire batch processing lock (5 minutes TTL)
    console.log(`🔐 ATTEMPTING LOCK: Trying to acquire batch lock for campaign ${campaignId}...`);
    lockValue = await streamManager.acquireBatchLock(LOCK_KEY, 300);
    if (!lockValue) {
      console.log(`❌ LOCK FAILED: Could not acquire batch processing lock for campaign ${campaignId}`);
      return NextResponse.json({
        success: false,
        message: "Failed to acquire batch processing lock",
        data: { batchesProcessed: 0 }
      });
    }

    console.log(`🔒 BATCH LOCK: Successfully acquired lock for campaign ${campaignId}`);

    // Ensure consumer group exists
    await streamManager.createConsumerGroup(STREAM_NAME, CONSUMER_GROUP_NAME);

    // Read batches from stream (process 1 batch at a time)
    console.log(`📥 READING STREAM: Checking for batches in ${STREAM_NAME}...`);
    const consumedBatches = await streamManager.readBatchFromStream(
      STREAM_NAME, 
      CONSUMER_GROUP_NAME, 
      CONSUMER_NAME, 
      1
    );

    if (!consumedBatches || consumedBatches.length === 0) {
      console.log(`⚠️ NO BATCHES: Stream is empty or no new batches available`);
      return NextResponse.json({
        success: true,
        message: "No batches available for processing",
        data: { batchesProcessed: 0 }
      });
    }

    console.log(`✅ BATCHES FOUND: ${consumedBatches.length} batch(es) ready for processing`);

    const results = [];
    let batchesProcessed = 0;
    let totalInvitesSent = 0;

    // Process each batch
    for (const [streamName, messages] of consumedBatches) {
      for (const [messageId, fields] of messages) {
        try {
          // Convert Redis stream fields array to batch object
          const batchData = {};
          for (let i = 0; i < fields.length; i += 2) {
            batchData[fields[i]] = fields[i + 1];
          }

          const campaignId = batchData.campaign_id;
          const linkedinAccountId = batchData.linkedin_account_id;
          const customMessage = batchData.custom_message;
          const leads = JSON.parse(batchData.leads);
          const batchSize = parseInt(batchData.batch_size);

          console.log(`📦 PROCESSING BATCH: ${batchData.batch_id} with ${batchSize} leads for campaign ${campaignId}`);

          // Initialize LinkedIn Invite Service for this batch
          const inviteService = new LinkedInInviteService();
          let browserInitialized = false;

          try {
            // Initialize browser once per batch
            await inviteService.initializeBrowser(linkedinAccountId);
            browserInitialized = true;

            // Restore LinkedIn session from database
            await inviteService.restoreSession(linkedinAccountId);

            // Skip session validation - already validated in Step 1 (activate endpoint)
            // await inviteService.validateSession();

            console.log('✅ Browser initialized and session restored - ready to send invites');

          } catch (error) {
            console.error('❌ Failed to initialize browser or validate session:', error);
            
            // If session is invalid, mark all leads in batch as failed
            // and throw error to stop processing
            throw new Error(`Session initialization failed: ${error.message}`);
          }

          // Process each lead in the batch (collect data first)
          const leadIdsToUpdate = [];
          const inviteUpdates = [];
          const failedLeads = []; // Track failed leads for re-queuing
          const redisUpdates = []; // Collect Redis updates for pipeline

          for (let i = 0; i < leads.length; i++) {
            const lead = leads[i];
            
            try {
              console.log(`📤 SENDING INVITE: ${i + 1}/${batchSize} - Lead ${lead.id} (${lead.name})`);
              
              // Send real LinkedIn invite using browser automation
              const result = await inviteService.sendInvite(lead, customMessage);
              
              // Check if invite was sent, already pending, or already connected
              if (result && result.success) {
                const status = result.status; // 'invite_sent', 'already_pending', or 'already_connected'
                const inviteStatus = status === 'invite_sent' ? 'sent' : 
                                   status === 'already_pending' ? 'pending' : 'accepted';
                
                // Prepare updates for successful invite (don't update yet)
                leadIdsToUpdate.push(lead.id);
                inviteUpdates.push({
                  id: lead.id,
                  inviteSent: true,
                  inviteStatus: inviteStatus,
                  inviteSentAt: new Date().toISOString()
                });

                // Collect Redis update data
                redisUpdates.push({
                  id: lead.id,
                  data: JSON.stringify({
                    ...lead,
                    inviteSent: true,
                    inviteStatus: inviteStatus,
                    inviteSentAt: new Date().toISOString()
                  })
                });

                totalInvitesSent++;
                
                console.log(`✅ ${status.toUpperCase()}: Lead ${lead.id} - ${lead.name}`);
              }

            } catch (error) {
              console.error(`❌ Failed to send invite to lead ${lead.id}:`, error);
              
              // Mark as failed and add to retry queue
              leadIdsToUpdate.push(lead.id);
              inviteUpdates.push({
                id: lead.id,
                inviteSent: false,
                inviteStatus: 'failed',
                inviteFailedAt: new Date().toISOString()
              });

              // Collect Redis update data for failed lead
              redisUpdates.push({
                id: lead.id,
                data: JSON.stringify({
                  ...lead,
                  inviteSent: false,
                  inviteStatus: 'failed',
                  inviteFailedAt: new Date().toISOString()
                })
              });

              // Add failed lead to retry queue (with retry limit)
              const retryCount = (lead.inviteRetryCount || 0) + 1;
              const maxRetries = 3; // Maximum 3 retries per lead
              
              if (retryCount <= maxRetries) {
                failedLeads.push({
                  ...lead,
                  inviteRetryCount: retryCount
                });
                
                console.log(`🔄 FAILED LEAD QUEUED: Lead ${lead.id} - ${lead.name} will be retried (attempt ${retryCount}/${maxRetries})`);
              } else {
                console.log(`❌ MAX RETRIES REACHED: Lead ${lead.id} - ${lead.name} exceeded ${maxRetries} retry attempts`);
              }
            }

            // Rate limiting: 2 seconds between invites (only if not the last lead)
            if (i < leads.length - 1) {
              console.log(`⏱️ RATE LIMIT: Waiting 2 seconds before next invite...`);
              await delay(2000);
            }
          }

          // Cleanup browser after processing all leads in batch
          if (browserInitialized) {
            try {
              await inviteService.cleanup();
            } catch (cleanupError) {
              console.error('❌ Browser cleanup error:', cleanupError);
            }
          }

          // Redis-First: Bulk update Redis cache and database
          if (leadIdsToUpdate.length > 0) {
            try {
              // OPTIMIZED: Redis Pipeline - Update all leads at once
              const pipeline = redis.pipeline();
              redisUpdates.forEach(update => {
                pipeline.hset(`campaign:${campaignId}:leads`, update.id, update.data);
              });
              await pipeline.exec();
              
              console.log(`🚀 REDIS PIPELINE: Updated ${leadIdsToUpdate.length} leads in single operation`);
              
              // OPTIMIZED: Bulk Database Update - Update all leads at once
              const successfulUpdates = inviteUpdates.filter(u => u.inviteStatus === 'sent');
              const failedUpdates = inviteUpdates.filter(u => u.inviteStatus === 'failed');
              
              // Bulk update successful invites
              if (successfulUpdates.length > 0) {
                const successfulIds = successfulUpdates.map(u => u.id);
                await db.update(leads)
                  .set({
                    inviteSent: true,
                    inviteStatus: 'sent',
                    inviteSentAt: new Date()
                  })
                  .where(inArray(leads.id, successfulIds));
              }
              
              // Bulk update failed invites
              if (failedUpdates.length > 0) {
                const failedIds = failedUpdates.map(u => u.id);
                await db.update(leads)
                  .set({
                    inviteSent: false,
                    inviteStatus: 'failed',
                    inviteFailedAt: new Date()
                  })
                  .where(inArray(leads.id, failedIds));
              }
              
              console.log(`💾 BULK DATABASE: Updated ${successfulUpdates.length} sent + ${failedUpdates.length} failed leads`);
              
            } catch (error) {
              console.error(`❌ Bulk Update: Failed to update cache or database:`, error);
            }
          }

          // Re-queue failed leads for retry
          if (failedLeads.length > 0) {
            try {
              console.log(`🔄 RE-QUEUING: ${failedLeads.length} failed leads for retry`);
              
              // Create retry batch for failed leads
              const retryBatchData = {
                batch_id: `retry-${batchData.batch_id}-${Date.now()}`,
                campaign_id: campaignId,
                linkedin_account_id: linkedinAccountId,
                custom_message: customMessage,
                leads: failedLeads,
                batch_size: failedLeads.length,
                created_at: new Date().toISOString(),
                is_retry: true // Mark as retry batch
              };
              
              // Add retry batch to the front of the queue (higher priority)
              await streamManager.addBatchToStream(STREAM_NAME, retryBatchData);
              
              console.log(`✅ RETRY BATCH QUEUED: ${failedLeads.length} failed leads re-queued for retry`);
              
            } catch (error) {
              console.error(`❌ Failed to re-queue failed leads:`, error);
            }
          }

          // Acknowledge batch in Redis
          await streamManager.acknowledgeBatch(STREAM_NAME, CONSUMER_GROUP_NAME, messageId);

          const successfulInvites = inviteUpdates.filter(u => u.inviteStatus === 'sent').length;
          const failedInvites = inviteUpdates.filter(u => u.inviteStatus === 'failed').length;

          console.log(`✅ BATCH COMPLETE: ${batchData.batch_id} - ${successfulInvites} sent, ${failedInvites} failed, ${failedLeads.length} re-queued (OPTIMIZED: Redis Pipeline + Bulk DB)`);

          results.push({
            success: true,
            batchId: batchData.batch_id,
            campaignId,
            leadsProcessed: leads.length,
            invitesSent: successfulInvites,
            invitesFailed: failedInvites,
            leadsRequeued: failedLeads.length,
            redisMessageId: messageId
          });

          batchesProcessed++;

          // Rate limiting: 5 minutes between batches
          console.log(`⏱️ BATCH RATE LIMIT: Waiting 5 minutes before next batch...`);
          await delay(300000); // 5 minutes

        } catch (error) {
          console.error(`❌ Failed to process batch ${messageId}:`, error);
          results.push({
            success: false,
            batchId: messageId,
            error: error.message
          });
        }
      }
    }

    const totalRequeued = results.reduce((sum, result) => sum + (result.leadsRequeued || 0), 0);
    const totalFailed = results.reduce((sum, result) => sum + (result.invitesFailed || 0), 0);

    console.log(`🎉 INVITE WORKER COMPLETE: ${batchesProcessed} batches processed, ${totalInvitesSent} invites sent, ${totalRequeued} leads re-queued`);

    return NextResponse.json({
      success: true,
      message: `Processed ${batchesProcessed} batches successfully`,
      data: {
        batchesProcessed,
        totalInvitesSent,
        totalFailed,
        totalRequeued,
        results
      }
    });

  } catch (error) {
    console.error("❌ Invite Worker Error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 }
    );
  } finally {
    // Always release the batch processing lock
    if (lockValue) {
      const streamManager = new RedisStreamManager();
      const released = await streamManager.releaseBatchLock(LOCK_KEY, lockValue);
      if (released) {
        console.log(`🔓 BATCH LOCK: Released lock for campaign ${campaignId}`);
      } else {
        console.error(`❌ BATCH LOCK: Failed to release lock for campaign ${campaignId}`);
      }
    }
  }
};

// Helper function for delays
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
