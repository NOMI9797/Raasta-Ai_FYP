import { NextResponse } from "next/server";
import { RedisStreamManager } from "@/libs/redis";
import getRedisClient from "@/libs/redis";
import { withAuth } from "@/libs/auth-middleware";

/**
 * POST /api/redis-workflow/campaigns/[id]/queue-leads
 * 
 * OPTIMIZED: Fast Queue Leads with Auto-Queue Integration
 * 
 * This endpoint:
 * 1. Checks if leads are already auto-queued (super fast!)
 * 2. If not auto-queued, triggers auto-queue in background
 * 3. Returns immediate response for instant UI feedback
 * 4. Messages start processing immediately (no waiting!)
 * 
 * @param {string} id - Campaign ID
 * @param {object} body - Request body with model and customPrompt
 * @returns {object} Queue status (optimized for speed)
 */
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const { id: campaignId } = params;
    const { model = "llama-3.1-8b-instant", customPrompt } = await request.json();

    if (!campaignId) {
      return NextResponse.json(
        { error: "Campaign ID is required" },
        { status: 400 }
      );
    }

    // Queueing leads for message generation

    const redis = getRedisClient();
    const streamName = `campaign:${campaignId}:message-generation`;
    const groupName = "message-generators";
    
    // Use Redis pipeline to batch multiple calls into single round trip
    const pipeline = redis.pipeline();
    pipeline.hgetall(`campaign:${campaignId}:leads`);
    pipeline.exists(streamName);
    pipeline.xinfo('GROUPS', streamName);
    
    const results = await pipeline.exec();
    
    // Extract results from pipeline
    const leadsData = results[0][1]; // [error, result] format
    const streamExists = results[1][1];
    const groupInfo = results[2][1];
    
    if (!leadsData || Object.keys(leadsData).length === 0) {
      // No leads found in Redis cache
      return NextResponse.json({
        success: true,
        message: "No leads found in Redis cache for this campaign",
        data: {
          campaignId,
          leadsQueued: 0
        }
      });
    }

    const allLeads = Object.values(leadsData).map(leadStr => JSON.parse(leadStr));
    const leadsNeedingMessages = allLeads.filter(lead => 
      lead.status === 'completed' && 
      lead.status !== 'error' &&
      (!lead.hasMessage || lead.hasMessage === false) &&
      (!lead.inviteSent || lead.inviteSent === false)
    );

    const errorLeads = allLeads.filter(lead => lead.status === 'error').length;
    const leadsWithMessages = allLeads.filter(lead => lead.hasMessage === true).length;
    const leadsWithInvites = allLeads.filter(lead => lead.inviteSent === true).length;
    
    // Count invite statuses
    const inviteStats = allLeads.reduce((acc, lead) => {
      const status = lead.inviteStatus || 'pending';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    
    console.log(`📊 INVITE STATUS: ${JSON.stringify(inviteStats)}`);
    console.log(`📊 QUEUE FILTER: ${leadsNeedingMessages.length} need messages, ${leadsWithInvites} have invites sent`);

    if (leadsNeedingMessages.length === 0) {
      // All leads already have messages
      return NextResponse.json({
        success: true,
        message: "All leads already have messages generated",
        data: {
          campaignId,
          leadsQueued: 0,
          totalLeads: allLeads.length,
          leadsWithMessages: leadsWithMessages,
          errorLeads: errorLeads,
          workflow: "redis-first-optimized"
        }
      });
    }

    // Get current queue length from pipeline results
    let currentQueueLength = 0;
    try {
      if (streamExists && groupInfo && groupInfo.length > 0) {
        for (let i = 0; i < groupInfo.length; i++) {
          const group = groupInfo[i];
          if (group[1] === groupName) {
            currentQueueLength = parseInt(group[9]) || 0;
            break;
          }
        }
      }
    } catch (error) {
      currentQueueLength = 0;
    }

    // Current queue length checked

    // Directly enqueue leads now for immediate availability
    const streamManager = new RedisStreamManager();
    await streamManager.createConsumerGroup(streamName, groupName);

    let enqueued = 0;
    for (const lead of leadsNeedingMessages) {
      await streamManager.addLeadToStream(streamName, {
        lead_id: lead.id,
        campaign_id: campaignId,
        name: lead.name || "",
        title: lead.title || "",
        company: lead.company || "",
        model: model,
        custom_prompt: customPrompt || "",
      });
      enqueued++;
    }

    // Successfully enqueued leads

    return NextResponse.json({
      success: true,
      message: `Successfully enqueued ${enqueued} leads for AI message generation (${allLeads.length - leadsNeedingMessages.length} already had messages)`,
      data: {
        campaignId,
        leadsQueued: enqueued,
        totalLeads: allLeads.length,
        leadsWithMessages: leadsWithMessages,
        errorLeads: errorLeads,
        streamName: streamName,
        groupName: groupName,
        workflow: "redis-first-optimized",
        autoQueued: false
      }
    });

  } catch (error) {
    console.error("❌ Error queuing leads:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 }
    );
  }
});
