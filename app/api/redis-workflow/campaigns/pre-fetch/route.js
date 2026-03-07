import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { campaigns, leads, messages } from "@/libs/schema";
import { eq, and, notExists } from "drizzle-orm";
import getRedisClient from "@/libs/redis";
import { withAuth } from "@/libs/auth-middleware";

export const POST = withAuth(async (request, { user }) => {
  try {
    const { userId } = await request.json();
    
    if (!userId) {
      return NextResponse.json(
        { error: "User ID is required" },
        { status: 400 }
      );
    }

    const redis = getRedisClient();

    // Prevent duplicate concurrent runs per user for 60s
    const lockKey = `prefetch:lock:user:${userId}`;
    const gotLock = await redis.set(lockKey, Date.now().toString(), 'NX', 'EX', 60);
    if (!gotLock) {
      console.log(`⏳ PRE-FETCH SKIPPED: already running for user ${userId}`);
      return NextResponse.json({ success: true, message: 'Pre-fetch already running', data: { userId, running: true } }, { status: 202 });
    }

    // Check if we have fresh cache (within 5 minutes)
    const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();
    
    // Get all campaigns from DB first to check cache
    console.log(`📊 PRE-FETCH STEP 1: Checking cache freshness...`);
    const userCampaigns = await db.select()
      .from(campaigns)
      .where(eq(campaigns.userId, user.id));

    if (userCampaigns.length === 0) {
      console.log(`⏭️ PRE-FETCH SKIPPED: No campaigns found for user ${userId}`);
      await redis.del(lockKey);
      return NextResponse.json({
        success: true,
        message: 'No campaigns to pre-fetch',
        data: { userId, campaignsTotal: 0, campaignsCached: 0, campaignsSkipped: 0, totalLeadsCached: 0 }
      });
    }

    // Check cache freshness for all campaigns
    let needsRefresh = false;
    const cacheChecks = await Promise.all(
      userCampaigns.map(async (campaign) => {
        const existingData = await redis.hgetall(`campaign:${campaign.id}:data`);
        if (!existingData || !existingData.id || !existingData.lastUpdated) {
          return true; // Missing cache
        }
        const lastUpdated = parseInt(existingData.lastUpdated, 10);
        const age = now - lastUpdated;
        return age > CACHE_TTL_MS; // Stale cache
      })
    );
    
    needsRefresh = cacheChecks.some(check => check === true);
    
    if (!needsRefresh) {
      console.log(`✅ PRE-FETCH SKIPPED: All campaigns have fresh cache (within ${CACHE_TTL_MS / 1000 / 60} minutes)`);
      await redis.del(lockKey);
      return NextResponse.json({
        success: true,
        message: 'Cache is fresh, no pre-fetch needed',
        data: {
          userId,
          campaignsTotal: userCampaigns.length,
          campaignsCached: 0,
          campaignsSkipped: userCampaigns.length,
          totalLeadsCached: 0,
          cached: true
        }
      });
    }

    console.log(`🚀 PRE-FETCH START: Cache is stale or missing, refreshing for user ${userId}`);
    console.log(`📊 PRE-FETCH STEP 2: Caching campaigns and leads to Redis...`);
    
    let totalLeadsCached = 0;
    let campaignsSkipped = 0;
    let campaignsCached = 0;
    
    // Pre-fetch leads for each campaign (bulk)
    for (const campaign of userCampaigns) {
      // Check if campaign cache is fresh
      const existingData = await redis.hgetall(`campaign:${campaign.id}:data`);
      const existingLeads = await redis.hgetall(`campaign:${campaign.id}:leads`);
      
      // Skip if cache is fresh (within TTL)
      if (existingData && existingData.id && existingData.lastUpdated) {
        const lastUpdated = parseInt(existingData.lastUpdated, 10);
        const age = now - lastUpdated;
        if (age <= CACHE_TTL_MS && existingLeads && Object.keys(existingLeads).length > 0) {
          console.log(`⏭️ PRE-FETCH: ${campaign.name} (${campaign.id}) → SKIPPED (fresh cache, ${Math.round(age / 1000)}s old)`);
          campaignsSkipped++;
          totalLeadsCached += Object.keys(existingLeads).length;
          continue;
        }
      }
      
      const campaignLeads = await db.select()
        .from(leads)
        .where(and(eq(leads.campaignId, campaign.id), eq(leads.userId, user.id)))
        .limit(1000); // Bulk fetch up to 1000 leads per campaign

      // Get existing messages for this campaign
      const campaignMessages = await db.select()
        .from(messages)
        .where(and(eq(messages.campaignId, campaign.id), eq(messages.userId, user.id)));

      // Count invite statuses
      const inviteStats = campaignLeads.reduce((acc, lead) => {
        const status = lead.inviteStatus || 'pending';
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {});
      
      console.log(`📦 PRE-FETCH: ${campaign.name} (${campaign.id}) → ${campaignLeads.length} leads, ${campaignMessages.length} messages`);
      console.log(`📊 INVITE STATUS: ${JSON.stringify(inviteStats)}`);

      // Store campaign data in Redis
      await redis.hset(`campaign:${campaign.id}:data`, {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        leadsCount: campaignLeads.length,
        messagesCount: campaignMessages.length,
        lastUpdated: Date.now()
      });

      // Store leads data in Redis (bulk)
      if (campaignLeads.length > 0) {
        const leadsData = {};
        // Create a set of lead IDs that have messages
        const leadsWithMessages = new Set(campaignMessages.map(msg => msg.leadId));
        
        campaignLeads.forEach(lead => {
          leadsData[lead.id] = JSON.stringify({
            id: lead.id,
            name: lead.name,
            title: lead.title,
            company: lead.company,
            url: lead.url,
            status: lead.status,
            hasMessage: leadsWithMessages.has(lead.id), // Include message status
            inviteSent: lead.inviteSent || false,
            inviteStatus: lead.inviteStatus || 'pending'
          });
        });
        
        await redis.hset(`campaign:${campaign.id}:leads`, leadsData);
        totalLeadsCached += campaignLeads.length;
      }

      // Store messages data in Redis (bulk)
      if (campaignMessages.length > 0) {
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
        
        await redis.hset(`campaign:${campaign.id}:messages`, messagesData);
        console.log(`💾 PRE-FETCH: Cached ${campaignMessages.length} messages for campaign ${campaign.id}`);
      }
      
      campaignsCached++;
    }

    console.log(`🎉 PRE-FETCH COMPLETE: ${campaignsCached} cached, ${campaignsSkipped} skipped, ${totalLeadsCached} total leads`);

    await redis.del(lockKey);

    return NextResponse.json({
      success: true,
      message: `Pre-fetch complete: ${campaignsCached} cached, ${campaignsSkipped} skipped`,
      data: {
        campaignsTotal: userCampaigns.length,
        campaignsCached,
        campaignsSkipped,
        totalLeadsCached,
        userId,
        workflow: "redis-pre-fetch"
      }
    });

  } catch (error) {
    console.error("❌ Redis Pre-Fetch: Error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 }
    );
  }
});
