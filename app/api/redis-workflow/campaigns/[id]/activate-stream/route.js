/**
 * Campaign Activation with SSE Streaming and Batch Processing
 * 
 * POST /api/redis-workflow/campaigns/[id]/activate-stream
 * 
 * Features:
 * - Real-time progress via Server-Sent Events (SSE)
 * - Sequential batch processing (10 leads per batch)
 * - Per-batch session validation
 * - Browser open only during batch processing
 * - Automatic retry logic based on Redis status
 * - Daily rate limit enforcement
 */

import { NextResponse } from "next/server";
import LinkedInSessionManager from "@/libs/linkedin-session";
import { withAuth } from "@/libs/auth-middleware";
import { db } from "@/libs/db";
import { campaigns, linkedinAccounts } from "@/libs/schema";
import { eq, and } from "drizzle-orm";

import { testLinkedInSession, cleanupBrowserSession } from "@/libs/linkedin-session-validator";
import { fetchEligibleLeads, getLeadAnalytics } from "@/libs/lead-status-manager";
import { processInvitesDirectly } from "@/libs/linkedin-invite-automation";
import { checkDailyLimit, incrementDailyCounter } from "@/libs/rate-limit-manager";

const sessionManager = new LinkedInSessionManager();

export const POST = withAuth(async (request, { params, user }) => {
  const { id: campaignId } = params;
  const { 
    customMessage = "Hi there! I'd like to connect with you.",
    batchSize = 10 
  } = await request.json();

  const encoder = new TextEncoder();
  
  // SSE stream for real-time progress
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data) => {
        const heartbeat = ':\n\n';
        const sseData = `data: ${JSON.stringify(data)}\n\n`;
        console.log(`📤 SSE Event:`, data.type);
        controller.enqueue(encoder.encode(heartbeat));
        controller.enqueue(encoder.encode(sseData));
      };

      try {
        console.log(`🚀 WORKFLOW ACTIVATION: Campaign ${campaignId}`);

        // ============================================================
        // STEP 1: Validate Campaign
        // ============================================================
        console.log(`📋 STEP 1: Validating campaign...`);
        
        const [campaign] = await db
          .select()
          .from(campaigns)
          .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, user.id)))
          .limit(1);

        if (!campaign) {
          console.error(`❌ Campaign ${campaignId} not found or unauthorized`);
          sendEvent({ type: 'error', message: 'Campaign not found' });
          controller.close();
          return;
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
          sendEvent({ type: 'error', message: 'No active LinkedIn account found. Please connect a LinkedIn account first.' });
          controller.close();
          return;
        }

        const accountData = activeAccount;
        const accountId = activeAccount.id;
        console.log(`✅ Active account: ${accountData.email} (${accountId})`);
        
        // ============================================================
        // STEP 3: Check Daily Limit
        // ============================================================
        console.log(`📊 STEP 3: Checking daily rate limits...`);
        
        const quotas = await checkDailyLimit(accountId);
        console.log(`📊 Daily quota: ${quotas.sent}/${quotas.limit} used, ${quotas.remaining} remaining`);
        
        if (!quotas.canSend) {
          const resetsIn = Math.ceil((quotas.resetsAt - new Date()) / (1000 * 60 * 60));
          console.error(`❌ Daily limit reached (${quotas.limit})`);
          sendEvent({ 
            type: 'error', 
            message: `Daily invite limit reached (${quotas.limit}). Resets in ${resetsIn} hours.`,
            quotas 
          });
          controller.close();
          return;
        }

        // ============================================================
        // STEP 4: Fetch Eligible Leads from Redis
        // ============================================================
        console.log(`📥 STEP 4: Fetching eligible leads from Redis...`);
        
        const { allLeads, eligibleLeads, source } = await fetchEligibleLeads(campaignId);
        console.log(`📊 Leads fetched from: ${source}`);
        console.log(`📊 Total leads: ${allLeads.length}, Eligible: ${eligibleLeads.length}`);
        
        if (eligibleLeads.length === 0) {
          console.log(`⚠️ No eligible leads found`);
          sendEvent({ type: 'error', message: 'No eligible leads found. All leads either have invites sent or are pending.' });
          controller.close();
          return;
        }

        // Limit to remaining quota
        const leadsToProcess = eligibleLeads.slice(0, Math.min(eligibleLeads.length, quotas.remaining));
        
        if (leadsToProcess.length < eligibleLeads.length) {
          console.log(`⚠️ Limited to ${leadsToProcess.length} leads (daily quota: ${quotas.remaining})`);
        }
        
        // Split into batches
        const batches = [];
        for (let i = 0; i < leadsToProcess.length; i += batchSize) {
          batches.push(leadsToProcess.slice(i, i + batchSize));
        }

        console.log(`📦 Created ${batches.length} batches from ${leadsToProcess.length} eligible leads`);
        console.log(`📦 Batch size: ${batchSize} leads per batch\n`);

        // Send start event
        sendEvent({ 
          type: 'start', 
          total: leadsToProcess.length,
          batches: batches.length,
          batchSize,
          quotas 
        });

        // ============================================================
        // STEP 5: Process Each Batch Sequentially
        // ============================================================
        let totalSent = 0;
        let totalFailed = 0;
        let totalAlreadyConnected = 0;
        let totalAlreadyPending = 0;
        let currentLeadIndex = 0;

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
          const batch = batches[batchIndex];
          
          console.log(`🔄 BATCH ${batchIndex + 1}/${batches.length}: Processing ${batch.length} leads`);

          // ============================================================
          // BATCH STEP 1: Validate Session (Open Browser)
          // ============================================================
          console.log(`🔐 Validating session for batch ${batchIndex + 1}...`);
          
          const sessionCheck = await testLinkedInSession(accountData, true);
          
          if (!sessionCheck.isValid) {
            console.error(`❌ Session invalid: ${sessionCheck.reason}`);
            
            // Mark account as inactive
            await db.update(linkedinAccounts)
              .set({ isActive: false })
              .where(eq(linkedinAccounts.id, accountId));
            
            console.log(`⚠️ Account ${accountId} marked as inactive`);
            
            sendEvent({ 
              type: 'error', 
              message: 'LinkedIn session expired. Please reconnect your account.',
              details: sessionCheck.reason
            });
            controller.close();
            return;
          }

          console.log(`✅ Session valid for batch ${batchIndex + 1}`);
          
          const browserContext = sessionCheck.context;
          const browserPage = sessionCheck.page;

          try {
            // ============================================================
            // BATCH STEP 2: Process Leads (Browser Stays Open, Check Redis Status)
            // ============================================================
            console.log(`🚀 Processing ${batch.length} leads in batch ${batchIndex + 1}...\n`);
            
            // Progress callback for SSE updates
            const progressCallback = (progressData) => {
              if (progressData.type === 'progress') {
                currentLeadIndex++;
                sendEvent({
                  ...progressData,
                  current: currentLeadIndex,
                  total: leadsToProcess.length,
                  batch: batchIndex + 1,
                  totalBatches: batches.length,
                  percentage: Math.round((currentLeadIndex / leadsToProcess.length) * 100)
                });
              }
            };

            // Process batch (checks Redis status internally, updates Redis first then DB)
            const batchResults = await processInvitesDirectly(
              browserContext,
              browserPage,
              batch,
              customMessage,
              campaignId,
              progressCallback
            );

            // Aggregate results
            totalSent += batchResults.sent;
            totalFailed += batchResults.failed;
            totalAlreadyConnected += batchResults.alreadyConnected;
            totalAlreadyPending += batchResults.alreadyPending;

            // Increment daily counter for successfully sent invites
            if (batchResults.sent > 0) {
              await incrementDailyCounter(accountId, batchResults.sent);
            }

            console.log(`✅ Batch ${batchIndex + 1} complete: ${batchResults.sent} sent, ${batchResults.failed} failed`);

          } catch (batchError) {
            console.error(`❌ Batch ${batchIndex + 1} error:`, batchError.message);
            
            // Don't stop entire workflow, mark batch as failed and continue
            totalFailed += batch.length;
            
            sendEvent({
              type: 'batch_error',
              batch: batchIndex + 1,
              totalBatches: batches.length,
              error: batchError.message
            });
            
          } finally {
            // ============================================================
            // BATCH STEP 3: Close Browser ✅
            // ============================================================
            console.log(`🔒 Closing browser after batch ${batchIndex + 1}...`);
            await cleanupBrowserSession(browserContext);
          }

          // ============================================================
          // BATCH STEP 4: Check Daily Limit
          // ============================================================
          const updatedQuotas = await checkDailyLimit(accountId);
          
          if (!updatedQuotas.canSend) {
            console.log(`⚠️ Daily limit reached after batch ${batchIndex + 1}`);
            console.log(`📊 Processed ${batchIndex + 1}/${batches.length} batches`);
            
            sendEvent({
              type: 'limit_reached',
              message: `Daily limit reached. Processed ${batchIndex + 1}/${batches.length} batches.`,
              batch: batchIndex + 1,
              totalBatches: batches.length,
              remaining: batches.length - (batchIndex + 1),
              quotas: updatedQuotas
            });
            break; // Stop processing more batches
          }

          // ============================================================
          // BATCH STEP 5: Delay Before Next Batch (if not last)
          // ============================================================
          if (batchIndex < batches.length - 1) {
            const delayMinutes = 5;
            const delayMs = delayMinutes * 60 * 1000;
            
            console.log(`⏱️ Waiting ${delayMinutes} minutes before next batch...`);
            
            sendEvent({
              type: 'batch_delay',
              message: `Waiting ${delayMinutes} minutes before next batch...`,
              nextBatch: batchIndex + 2,
              totalBatches: batches.length,
              delayMinutes
            });
            
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        }

        // ============================================================
        // FINAL: Send Completion Event
        // ============================================================
        console.log(`🎉 WORKFLOW COMPLETE: ${totalSent} sent, ${totalFailed} failed`);
        
        sendEvent({
          type: 'complete',
          total: leadsToProcess.length,
          sent: totalSent,
          alreadyConnected: totalAlreadyConnected,
          alreadyPending: totalAlreadyPending,
          failed: totalFailed
        });

        controller.close();

      } catch (error) {
        console.error("❌ Workflow error:", error);
        console.error("❌ Stack:", error.stack);
        sendEvent({
          type: 'error',
          message: error.message || 'Internal server error',
          details: error.stack
        });
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Content-Encoding': 'none',
    },
  });
});

