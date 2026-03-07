import { NextResponse } from "next/server";
import getRedisClient from "@/libs/redis";
import { db } from "@/libs/db";
import { campaigns, leads, messages } from "@/libs/schema";
import { eq } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";

/**
 * POST /api/redis-workflow/campaigns/[id]/refresh-cache
 * 
 * Refreshes Redis cache for a specific campaign by fetching fresh data from DB
 * This ensures Redis has the latest campaign and leads data
 */
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const { id: campaignId } = params;
    
    if (!campaignId) {
      return NextResponse.json(
        { error: "Campaign ID is required" },
        { status: 400 }
      );
    }

    console.log(`🔄 CACHE REFRESH: Starting cache refresh for campaign ${campaignId}`);

    const redis = getRedisClient();
    
    // Step 1: Fetch fresh campaign data from DB
    console.log(`📊 CACHE REFRESH: Fetching campaign data from DB for ${campaignId}`);
    const [campaignData] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId));

    if (!campaignData) {
      console.log(`❌ CACHE REFRESH: Campaign ${campaignId} not found in DB`);
      return NextResponse.json(
        { error: "Campaign not found" },
        { status: 404 }
      );
    }

    // Step 2: Fetch fresh leads data from DB
    console.log(`📊 CACHE REFRESH: Fetching leads data from DB for campaign ${campaignId}`);
    const campaignLeads = await db
      .select()
      .from(leads)
      .where(eq(leads.campaignId, campaignId));

    // Step 3: Fetch fresh messages data from DB
    console.log(`📊 CACHE REFRESH: Fetching messages data from DB for campaign ${campaignId}`);
    const campaignMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.campaignId, campaignId));

    // Count invite statuses
    const inviteStats = campaignLeads.reduce((acc, lead) => {
      const status = lead.inviteStatus || 'pending';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    
    console.log(`📦 CACHE REFRESH: Found ${campaignLeads.length} leads and ${campaignMessages.length} messages in DB for campaign ${campaignId}`);
    console.log(`📊 INVITE STATUS: ${JSON.stringify(inviteStats)}`);

    // Step 4: Clear existing Redis cache for this campaign
    console.log(`🗑️ CACHE REFRESH: Clearing existing Redis cache for campaign ${campaignId}`);
    await redis.del(`campaign:${campaignId}:data`);
    await redis.del(`campaign:${campaignId}:leads`);
    await redis.del(`campaign:${campaignId}:messages`);

    // Step 5: Update Redis with fresh campaign data
    console.log(`💾 CACHE REFRESH: Updating Redis with fresh campaign data for ${campaignId}`);
    await redis.hset(`campaign:${campaignId}:data`, {
      id: campaignData.id,
      name: campaignData.name,
      status: campaignData.status,
      leadsCount: campaignLeads.length,
      messagesCount: campaignMessages.length,
      lastUpdated: Date.now()
    });

    // Step 6: Update Redis with fresh leads data
    if (campaignLeads.length > 0) {
      console.log(`💾 CACHE REFRESH: Updating Redis with ${campaignLeads.length} fresh leads for campaign ${campaignId}`);
      const leadsData = {};
      campaignLeads.forEach(lead => {
        leadsData[lead.id] = JSON.stringify({
          id: lead.id,
          name: lead.name,
          title: lead.title,
          company: lead.company,
          url: lead.url,
          status: lead.status,
          profilePicture: lead.profilePicture,
          posts: lead.posts,
          inviteSent: lead.inviteSent || false,
          inviteStatus: lead.inviteStatus || 'pending'
        });
      });
      
      await redis.hset(`campaign:${campaignId}:leads`, leadsData);
    }

    // Step 7: Update Redis with fresh messages data
    if (campaignMessages.length > 0) {
      console.log(`💾 CACHE REFRESH: Updating Redis with ${campaignMessages.length} fresh messages for campaign ${campaignId}`);
      const messagesData = {};
      campaignMessages.forEach(message => {
        messagesData[message.leadId] = JSON.stringify({
          id: message.id,
          leadId: message.leadId,
          campaignId: message.campaignId,
          content: message.content,
          model: message.model,
          customPrompt: message.customPrompt,
          status: message.status,
          createdAt: message.createdAt
        });
      });
      
      await redis.hset(`campaign:${campaignId}:messages`, messagesData);
    }

    // Step 8: Verify cache update
    const cachedCampaignData = await redis.hgetall(`campaign:${campaignId}:data`);
    const cachedLeadsData = await redis.hgetall(`campaign:${campaignId}:leads`);
    const cachedMessagesData = await redis.hgetall(`campaign:${campaignId}:messages`);
    
    console.log(`✅ CACHE REFRESH: Successfully refreshed cache for campaign ${campaignId}`);
    console.log(`📊 CACHE REFRESH: Campaign data cached: ${Object.keys(cachedCampaignData).length} fields`);
    console.log(`📊 CACHE REFRESH: Leads data cached: ${Object.keys(cachedLeadsData).length} leads`);
    console.log(`📊 CACHE REFRESH: Messages data cached: ${Object.keys(cachedMessagesData).length} messages`);

    return NextResponse.json({
      success: true,
      message: `Successfully refreshed cache for campaign ${campaignId}`,
      data: {
        campaignId,
        campaignName: campaignData.name,
        leadsCount: campaignLeads.length,
        cacheUpdated: true,
        workflow: "cache-refresh"
      }
    });

  } catch (error) {
    console.error("❌ CACHE REFRESH: Error refreshing cache:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 }
    );
  }
});
