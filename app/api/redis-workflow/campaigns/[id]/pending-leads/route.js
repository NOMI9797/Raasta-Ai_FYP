import { NextResponse } from "next/server";
import getRedisClient from "@/libs/redis";
import { withAuth } from "@/libs/auth-middleware";

/**
 * GET /api/redis-workflow/campaigns/[id]/pending-leads
 * 
 * Redis Workflow: Get leads ready for message generation
 * 
 * This endpoint:
 * 1. Fetches all COMPLETED leads for a campaign that don't have messages yet
 * 2. Returns lead details for Redis workflow processing
 * 3. OPTIMIZED: Only returns leads without existing messages
 * 
 * @param {string} id - Campaign ID
 * @returns {object} Leads ready for message generation (without existing messages)
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
    
    // Use Redis pipeline for single round trip
    const pipeline = redis.pipeline();
    pipeline.hgetall(`campaign:${campaignId}:leads`);
    pipeline.hgetall(`campaign:${campaignId}:messages`);
    
    const results = await pipeline.exec();
    const leadsData = results[0][1]; // [error, result] format
    const messagesData = results[1][1];
    
    if (!leadsData || Object.keys(leadsData).length === 0) {
      // No leads found in Redis cache
      return NextResponse.json({
        success: true,
        data: {
          campaignId,
          leadsReadyForMessages: [],
          count: 0,
          workflow: "redis-first"
        }
      });
    }

    const leads = Object.values(leadsData).map(leadStr => JSON.parse(leadStr));

    // Create a set of lead IDs that already have messages from Redis cache
    const leadsWithMessages = new Set();
    if (messagesData && Object.keys(messagesData).length > 0) {
      Object.values(messagesData).forEach(messageStr => {
        const message = JSON.parse(messageStr);
        leadsWithMessages.add(message.leadId);
      });
    }

    // Filter out leads that already have messages and exclude error leads
    const leadsReadyForMessages = leads.filter(lead => 
      !leadsWithMessages.has(lead.id) && 
      lead.status === 'completed' && 
      lead.status !== 'error'
    );

    const errorLeads = leads.filter(lead => lead.status === 'error').length;
    const leadsWithMessagesCount = leads.filter(lead => leadsWithMessages.has(lead.id)).length;
    const completedLeads = leads.filter(lead => lead.status === 'completed').length;
    // Filtered leads for message generation

    return NextResponse.json({
      success: true,
        data: {
          campaignId,
          leadsReadyForMessages,
          count: leadsReadyForMessages.length,
          totalLeads: leads.length,
          leadsWithMessages: leadsWithMessagesCount,
          errorLeads: errorLeads,
          completedLeads: completedLeads,
          workflow: "redis-first"
        }
    });

  } catch (error) {
    console.error("❌ Error getting leads:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
});
