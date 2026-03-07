import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { campaigns, leads, messages } from "@/libs/schema";
import { desc, eq, count, and, sql } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import getRedisClient from "@/libs/redis";

// GET /api/campaigns - Get all campaigns for authenticated user (Redis-first, DB fallback)
export const GET = withAuth(async (request, { user }) => {
  try {
    let redis = null;
    const cacheKey = `user:${user.id}:campaigns:list`;

    // ✅ REDIS-FIRST: Try cache only when Redis is configured and reachable
    if (process.env.REDIS_URL) {
      try {
        redis = getRedisClient();
        const cachedData = await Promise.race([
          redis.get(cacheKey),
          new Promise((_, rej) => setTimeout(() => rej(new Error('Redis timeout')), 3000)),
        ]);
        if (cachedData) {
          const parsed = JSON.parse(cachedData);
          console.log(`✅ REDIS: Returning campaigns from cache for user ${user.id}`);
          return NextResponse.json({
            success: true,
            campaigns: parsed,
            cached: true,
          });
        }
      } catch (redisError) {
        console.warn(`⚠️ Redis read failed, falling back to DB:`, redisError?.message || redisError);
        redis = null;
      }
    }

    // ✅ FALLBACK: Query database if Redis cache miss
    console.log(`📊 DB: Fetching campaigns from database for user ${user.id}`);
    
    // ✅ OPTIMIZED: Single query with conditional aggregations
    // Gets all campaign data + counts in ONE database round trip
    const allCampaigns = await db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        description: campaigns.description,
        icpConfig: campaigns.icpConfig,
        status: campaigns.status,
        createdAt: campaigns.createdAt,
        updatedAt: campaigns.updatedAt,
        // Total leads count
        leadsCount: sql`COUNT(DISTINCT ${leads.id})`.as('leads_count'),
        // Processed leads count (status = 'completed')
        processedLeads: sql`COUNT(DISTINCT CASE WHEN ${leads.status} = ${'completed'} THEN ${leads.id} END)`.as('processed_leads'),
        // Total messages count
        messagesGenerated: sql`COUNT(DISTINCT ${messages.id})`.as('messages_generated'),
        // Sent messages count (status = 'sent')
        messagesSent: sql`COUNT(DISTINCT CASE WHEN ${messages.status} = ${'sent'} THEN ${messages.id} END)`.as('messages_sent'),
      })
      .from(campaigns)
      .leftJoin(leads, and(eq(campaigns.id, leads.campaignId), eq(leads.userId, user.id)))
      .leftJoin(messages, and(eq(campaigns.id, messages.campaignId), eq(messages.userId, user.id)))
      .where(eq(campaigns.userId, user.id))
      .groupBy(campaigns.id)
      .orderBy(desc(campaigns.createdAt));

    // Calculate status and prepare batch updates
    const campaignsWithProgress = [];
    const statusUpdates = [];

    for (const campaign of allCampaigns) {
      const totalLeads = Number(campaign.leadsCount) || 0;
      const processedLeads = Number(campaign.processedLeads) || 0;
      const messagesSent = Number(campaign.messagesSent) || 0;

      // Determine the correct status based on campaign state
      let newStatus = campaign.status;
      if (totalLeads === 0) {
        newStatus = 'draft'; // No leads added yet
      } else if (processedLeads === 0) {
        newStatus = 'active'; // Has leads but none processed yet
      } else if (processedLeads < totalLeads) {
        newStatus = 'active'; // Some leads processed, still in progress
      } else if (processedLeads === totalLeads && totalLeads > 0) {
        newStatus = 'completed'; // All leads processed
      }

      // Track campaigns that need status updates
      if (newStatus !== campaign.status) {
        statusUpdates.push({
          id: campaign.id,
          status: newStatus,
        });
      }

      campaignsWithProgress.push({
        id: campaign.id,
        name: campaign.name,
        description: campaign.description,
        icpConfig: campaign.icpConfig,
        status: newStatus,
        createdAt: campaign.createdAt,
        updatedAt: campaign.updatedAt,
        leadsCount: totalLeads,
        processedLeads: processedLeads,
        messagesGenerated: Number(campaign.messagesGenerated) || 0,
        messagesSent: messagesSent,
      });
    }

    // ✅ OPTIMIZED: Batch update all status changes in one query (if any)
    if (statusUpdates.length > 0) {
      // Use Promise.all for parallel updates, or use a single batch update if Drizzle supports it
      await Promise.all(
        statusUpdates.map(({ id, status }) =>
          db
            .update(campaigns)
            .set({
              status: status,
              updatedAt: new Date(),
            })
            .where(and(eq(campaigns.id, id), eq(campaigns.userId, user.id)))
        )
      );
    }

    // ✅ REDIS: Cache the result for future requests (5 min TTL) when Redis is available
    if (redis) {
      try {
        await redis.setex(cacheKey, 300, JSON.stringify(campaignsWithProgress));
        console.log(`✅ REDIS: Cached campaigns list for user ${user.id}`);
      } catch (redisError) {
        console.warn(`⚠️ Redis cache write failed:`, redisError?.message || redisError);
      }
    }

    return NextResponse.json({
      success: true,
      campaigns: campaignsWithProgress,
      cached: false,
    });
  } catch (error) {
    console.error("Get campaigns error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
});

// POST /api/campaigns - Create a new campaign for authenticated user (Redis-first)
export const POST = withAuth(async (request, { user }) => {
  try {
    const { name, description, icpConfig } = await request.json();

    if (!name || name.trim().length === 0) {
      return NextResponse.json(
        { error: "Campaign name is required" },
        { status: 400 }
      );
    }

    const redis = getRedisClient();
    const cacheKey = `user:${user.id}:campaigns:list`;

    // ✅ REDIS-FIRST: Invalidate cache before DB operation
    try {
      await redis.del(cacheKey);
      console.log(`✅ REDIS: Invalidated campaigns cache for user ${user.id}`);
    } catch (redisError) {
      console.warn(`⚠️ Redis cache invalidation failed:`, redisError.message);
    }

    // ✅ DB: Insert new campaign (icpConfig: { targetRole, industry, serviceType })
    const [newCampaign] = await db
      .insert(campaigns)
      .values({
        userId: user.id,
        name: name.trim(),
        description: description?.trim() || null,
        icpConfig: icpConfig && (icpConfig.targetRole || icpConfig.industry || icpConfig.serviceType) ? icpConfig : null,
        status: "draft",
      })
      .returning();

    // ✅ REDIS: Update individual campaign cache
    try {
      await redis.hset(`campaign:${newCampaign.id}:data`, {
        id: newCampaign.id,
        name: newCampaign.name,
        description: newCampaign.description || '',
        status: newCampaign.status,
        leadsCount: 0,
        messagesCount: 0,
        lastUpdated: Date.now()
      });
      console.log(`✅ REDIS: Cached new campaign ${newCampaign.id}`);
    } catch (redisError) {
      console.warn(`⚠️ Redis campaign cache update failed:`, redisError.message);
    }

    return NextResponse.json({
      success: true,
      campaign: newCampaign,
    });
  } catch (error) {
    console.error("Create campaign error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
});