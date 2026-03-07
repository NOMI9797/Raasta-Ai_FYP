import { NextResponse } from "next/server";
import getRedisClient from "@/libs/redis";
import { withAuth } from "@/libs/auth-middleware";

/**
 * GET /api/redis-workflow/campaigns/[id]/generation-status
 * 
 * Redis-First: Get real-time generation status from Redis cache + Auto-Queue
 * 
 * This endpoint:
 * 1. Gets campaign data from Redis cache (no DB queries)
 * 2. Gets Redis stream queue length
 * 3. Auto-queues leads without messages for faster processing
 * 4. Returns real-time status
 * 
 * @param {string} id - Campaign ID
 * @returns {object} Real-time generation status
 */
export const GET = withAuth(async (request, { params, user }) => {
  try {
    const { id: campaignId } = params;

    if (!campaignId) {
      return NextResponse.json(
        { error: "Campaign ID is required" },
        { status: 400 }
      );
    }

    // Getting generation status

    const redis = getRedisClient();
    const streamName = `campaign:${campaignId}:message-generation`;
    const groupName = "message-generators";
    
    // Use Redis pipeline to batch multiple calls into single round trip
    const pipeline = redis.pipeline();
    pipeline.hgetall(`campaign:${campaignId}:data`);
    pipeline.hgetall(`campaign:${campaignId}:leads`);
    pipeline.exists(streamName);
    pipeline.xinfo('GROUPS', streamName);
    
    const results = await pipeline.exec();
    
    // Extract results from pipeline
    const campaignData = results[0][1]; // [error, result] format
    const leadsData = results[1][1];
    const streamExists = results[2][1];
    const groupInfo = results[3][1];
    
    if (!leadsData || Object.keys(leadsData).length === 0) {
      // No leads found - this is normal for new campaigns, don't log repeatedly
      return NextResponse.json({
        success: true,
        data: {
          campaignId,
          leads: { pending: 0, completed: 0, error: 0, total: 0 },
          messages: { total: 0 },
          redis: { queueLength: 0, streamName: streamName, groupName: groupName },
          workflow: "redis-first",
          timestamp: Date.now()
        }
      });
    }

    const leads = Object.values(leadsData).map(leadStr => JSON.parse(leadStr));
    const leadsNeedingMessages = leads.filter(lead => 
      lead.status === 'completed' && 
      lead.status !== 'error' &&
      (!lead.hasMessage || lead.hasMessage === false) &&
      (!lead.inviteSent || lead.inviteSent === false)
    );

    // Count invite statuses
    const inviteStats = leads.reduce((acc, lead) => {
      const status = lead.inviteStatus || 'pending';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    
    const leadsWithInvites = leads.filter(lead => lead.inviteSent === true).length;
    
    console.log(`📊 INVITE STATUS: ${JSON.stringify(inviteStats)}`);
    console.log(`📊 STATUS FILTER: ${leadsNeedingMessages.length} need messages, ${leadsWithInvites} have invites sent`);
    
    // Found leads ready for messages

    // Get Redis stream queue length from pipeline results
    let streamLength = 0;
    try {
      if (streamExists && groupInfo && groupInfo.length > 0) {
        for (let i = 0; i < groupInfo.length; i++) {
          const group = groupInfo[i];
          if (group[1] === groupName) {
            streamLength = parseInt(group[9]) || 0;
            break;
          }
        }
      }
    } catch (error) {
      streamLength = 0;
    }

    // Auto-queue leads that need messages (background process) - with smart conditions and circuit breaker
    if (leadsNeedingMessages.length > 0) {
      // Check if there's already a queue to prevent spam
      if (streamLength === 0) {
        // Circuit breaker: Check if auto-queue was recently attempted
        const autoQueueKey = `auto-queue:${campaignId}:attempt`;
        const now = Date.now();
        const cooldownPeriod = 30000; // 30 seconds cooldown
        
        // Use pipeline for auto-queue check and set
        const autoQueuePipeline = redis.pipeline();
        autoQueuePipeline.get(autoQueueKey);
        autoQueuePipeline.setex(autoQueueKey, 60, now.toString());
        
        const autoQueueResults = await autoQueuePipeline.exec();
        const lastAttempt = autoQueueResults[0][1];
        
        if (!lastAttempt || (now - parseInt(lastAttempt)) > cooldownPeriod) {
          try {
            // Trigger auto-queue in background (don't wait for response)
            fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:8085'}/api/redis-workflow/campaigns/${campaignId}/auto-queue`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                model: "llama-3.1-8b-instant",
                customPrompt: ""
              })
            }).catch(error => {
              console.log(`⚠️ Auto-queue background call failed: ${error.message}`);
            });
            
            console.log(`🚀 Auto-queue triggered for campaign ${campaignId}`);
          } catch (error) {
            console.log(`⚠️ Auto-queue trigger failed: ${error.message}`);
          }
        } else {
          const timeLeft = Math.ceil((cooldownPeriod - (now - parseInt(lastAttempt))) / 1000);
          console.log(`⏳ Auto-queue skipped due to cooldown (${timeLeft}s remaining)`);
        }
      } else {
        console.log(`⏭️ Auto-queue skipped - queue already has ${streamLength} items`);
      }
    } else {
      console.log(`✅ Auto-queue skipped - no leads need messages`);
    }

    const leadsCount = Object.keys(leadsData).length;
    
    const statusData = {
      campaignId,
      leads: {
        pending: 0,
        completed: leadsCount,
        error: 0,
        total: leadsCount
      },
      messages: {
        total: 0 // Will be updated by worker
      },
      redis: {
        queueLength: streamLength,
        streamName: streamName,
        groupName: "message-generators"
      },
      workflow: "redis-first-auto-queue",
      timestamp: Date.now()
    };

    // Status updated

    return NextResponse.json({
      success: true,
      data: statusData
    });

  } catch (error) {
    console.error("❌ Error getting status:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 }
    );
  }
});