import { NextResponse } from "next/server";
import getRedisClient, { RedisStreamManager } from "@/libs/redis";
import { withAuth } from "@/libs/auth-middleware";

/**
 * POST /api/redis-workflow/campaigns/[id]/auto-queue
 *
 * Reads campaign leads from Redis, filters ones without messages,
 * and enqueues them into the Redis stream for message generation.
 */
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const { id: campaignId } = params;
    const { model = "llama-3.1-8b-instant", customPrompt = "" } = await request.json().catch(() => ({}));

    if (!campaignId) {
      return NextResponse.json(
        { error: "Campaign ID is required" },
        { status: 400 }
      );
    }

    const redis = getRedisClient();
    const streamManager = new RedisStreamManager();

    const STREAM_NAME = `campaign:${campaignId}:message-generation`;
    const GROUP_NAME = "message-generators";

    // Use Redis pipeline to batch calls
    const pipeline = redis.pipeline();
    pipeline.hgetall(`campaign:${campaignId}:leads`);
    
    const results = await pipeline.exec();
    const leadsData = results[0][1]; // [error, result] format

    // Ensure consumer group exists (creates stream if missing)
    await streamManager.createConsumerGroup(STREAM_NAME, GROUP_NAME);
    if (!leadsData || Object.keys(leadsData).length === 0) {
      return NextResponse.json({
        success: true,
        message: "No leads found in Redis cache for this campaign",
        data: { campaignId, leadsQueued: 0 }
      });
    }

    const allLeads = Object.values(leadsData).map((s) => JSON.parse(s));

    // Filter leads that are completed and do not yet have a message flag (exclude error leads)
    const leadsNeedingMessages = allLeads.filter((lead) =>
      lead.status === "completed" && 
      lead.status !== "error" &&
      (!lead.hasMessage || lead.hasMessage === false) &&
      (!lead.inviteSent || lead.inviteSent === false)
    );

    // Count invite statuses
    const inviteStats = allLeads.reduce((acc, lead) => {
      const status = lead.inviteStatus || 'pending';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    
    const leadsWithInvites = allLeads.filter(lead => lead.inviteSent === true).length;
    
    console.log(`📊 INVITE STATUS: ${JSON.stringify(inviteStats)}`);
    console.log(`📊 AUTO-QUEUE FILTER: ${leadsNeedingMessages.length} need messages, ${leadsWithInvites} have invites sent`);

    if (leadsNeedingMessages.length === 0) {
      return NextResponse.json({
        success: true,
        message: "All leads already have messages generated",
        data: { campaignId, leadsQueued: 0 }
      });
    }

    // Enqueue each lead
    let enqueued = 0;
    for (const lead of leadsNeedingMessages) {
      await streamManager.addLeadToStream(STREAM_NAME, {
        lead_id: lead.id,
        campaign_id: campaignId,
        name: lead.name || "",
        title: lead.title || "",
        company: lead.company || "",
        model,
        custom_prompt: customPrompt,
      });
      enqueued++;
    }

    return NextResponse.json({
      success: true,
      message: `Queued ${enqueued} leads for AI message generation`,
      data: {
        campaignId,
        leadsQueued: enqueued,
        streamName: STREAM_NAME,
        groupName: GROUP_NAME,
        workflow: "redis-first-auto-queue",
      },
    });
  } catch (error) {
    console.error("❌ Auto-Queue error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 }
    );
  }
});


