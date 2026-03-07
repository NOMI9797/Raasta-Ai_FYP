import { NextResponse } from "next/server";
import getRedisClient, { RedisStreamManager } from "@/libs/redis";
import { withAuth } from "@/libs/auth-middleware";

/**
 * GET /api/redis-workflow/campaigns/[id]/invite-status
 * 
 * Real-time invite status tracking from Redis cache
 * 
 * This endpoint:
 * 1. Gets campaign data from Redis cache
 * 2. Gets invite stream queue length
 * 3. Returns real-time invite status
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

    const redis = getRedisClient();
    const streamManager = new RedisStreamManager();
    
    const STREAM_NAME = `campaign:${campaignId}:invite-sending`;
    const GROUP_NAME = "invite-senders";
    const LOCK_KEY = `batch-processing:campaign:${campaignId}`;
    
    // Use Redis pipeline to batch multiple calls
    const pipeline = redis.pipeline();
    pipeline.hgetall(`campaign:${campaignId}:data`);
    pipeline.hgetall(`campaign:${campaignId}:leads`);
    pipeline.exists(STREAM_NAME);
    pipeline.xinfo('GROUPS', STREAM_NAME);
    
    const results = await pipeline.exec();
    
    // Extract results from pipeline
    const campaignData = results[0][1]; // [error, result] format
    const leadsData = results[1][1];
    const streamExists = results[2][1];
    const groupInfo = results[3][1];
    
    if (!leadsData || Object.keys(leadsData).length === 0) {
      return NextResponse.json({
        success: true,
        message: "No leads found in Redis cache for this campaign",
        data: {
          campaignId,
          inviteStats: {},
          queueLength: 0,
          pendingBatches: 0
        }
      });
    }

    const leads = Object.values(leadsData).map(leadStr => JSON.parse(leadStr));

    // Count invite statuses
    const inviteStats = leads.reduce((acc, lead) => {
      const status = lead.inviteStatus || 'pending';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});

    const leadsWithInvites = leads.filter(lead => lead.inviteSent === true).length;
    const leadsNeedingInvites = leads.filter(lead => 
      lead.status === 'completed' && 
      lead.status !== 'error' &&
      (!lead.inviteSent || lead.inviteSent === false) &&
      (lead.inviteStatus === 'pending' || lead.inviteStatus === 'failed' || !lead.inviteStatus)
    ).length;

    // Get stream queue length
    let queueLength = 0;
    let pendingBatches = 0;
    let isProcessing = false;
    
    if (streamExists) {
      try {
        const streamInfo = await streamManager.getBatchInfo(STREAM_NAME);
        queueLength = streamInfo ? streamInfo[1] : 0; // Second element is length
        
        if (groupInfo && groupInfo.length > 0) {
          pendingBatches = await streamManager.getBatchPendingCount(STREAM_NAME, GROUP_NAME);
        }
      } catch (error) {
        console.error('❌ Error getting stream info:', error);
      }
    }

    // Check if batch processing is locked
    try {
      isProcessing = await streamManager.isBatchLocked(LOCK_KEY);
    } catch (error) {
      console.error('❌ Error checking batch lock:', error);
    }

    console.log(`📊 INVITE STATUS: ${JSON.stringify(inviteStats)}`);
    console.log(`📊 QUEUE STATUS: ${queueLength} batches queued, ${pendingBatches} pending`);

    return NextResponse.json({
      success: true,
      data: {
        campaign: {
          id: campaignData.id,
          name: campaignData.name,
          status: campaignData.status,
          leadsCount: parseInt(campaignData.leadsCount) || 0,
          lastUpdated: parseInt(campaignData.lastUpdated) || 0
        },
        inviteStats: {
          total: leads.length,
          pending: inviteStats.pending || 0,
          sent: inviteStats.sent || 0,
          accepted: inviteStats.accepted || 0,
          rejected: inviteStats.rejected || 0,
          failed: inviteStats.failed || 0,
          leadsWithInvites,
          leadsNeedingInvites
        },
        queue: {
          length: queueLength,
          pendingBatches,
          streamExists: !!streamExists,
          isProcessing
        },
        workflow: "redis-first-batch"
      }
    });

  } catch (error) {
    console.error("❌ Invite Status Error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 }
    );
  }
});
