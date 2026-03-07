import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { campaigns } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import getRedisClient from "@/libs/redis";

// GET /api/campaigns/[id] - Get a specific campaign for authenticated user
export const GET = withAuth(async (request, { params, user }) => {
  try {
    const campaignId = params.id;

    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, user.id)))
      .limit(1);

    if (!campaign) {
      return NextResponse.json(
        { error: "Campaign not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      campaign: campaign,
    });
  } catch (error) {
    console.error("Get campaign error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
});

// PUT /api/campaigns/[id] - Update a campaign for authenticated user (Redis-first)
export const PUT = withAuth(async (request, { params, user }) => {
  try {
    const campaignId = params.id;
    const updateData = await request.json();

    const redis = getRedisClient();
    const cacheKey = `user:${user.id}:campaigns:list`;

    // ✅ REDIS-FIRST: Invalidate cache before DB operation
    try {
      await redis.del(cacheKey);
      await redis.del(`campaign:${campaignId}:data`);
      console.log(`✅ REDIS: Invalidated cache for campaign ${campaignId}`);
    } catch (redisError) {
      console.warn(`⚠️ Redis cache invalidation failed:`, redisError.message);
    }

    // Check if campaign exists and belongs to user
    const [existingCampaign] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, user.id)))
      .limit(1);

    if (!existingCampaign) {
      return NextResponse.json(
        { error: "Campaign not found" },
        { status: 404 }
      );
    }

    // Only allow updating name, description, icpConfig
    const { name, description, icpConfig } = updateData;
    const setData = { updatedAt: new Date() };
    if (name !== undefined) setData.name = name.trim();
    if (description !== undefined) setData.description = description?.trim() || null;
    if (icpConfig !== undefined) setData.icpConfig = icpConfig && (icpConfig.targetRole || icpConfig.industry || icpConfig.serviceType) ? icpConfig : null;

    const [updatedCampaign] = await db
      .update(campaigns)
      .set(setData)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, user.id)))
      .returning();

    return NextResponse.json({
      success: true,
      campaign: updatedCampaign,
    });
  } catch (error) {
    console.error("Update campaign error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
});

// DELETE /api/campaigns/[id] - Delete a campaign for authenticated user (Redis-first)
export const DELETE = withAuth(async (request, { params, user }) => {
  try {
    const campaignId = params.id;

    const redis = getRedisClient();
    const cacheKey = `user:${user.id}:campaigns:list`;

    // ✅ REDIS-FIRST: Invalidate cache before DB operation
    try {
      await redis.del(cacheKey);
      await redis.del(`campaign:${campaignId}:data`);
      await redis.del(`campaign:${campaignId}:leads`);
      await redis.del(`campaign:${campaignId}:messages`);
      console.log(`✅ REDIS: Invalidated all cache for campaign ${campaignId}`);
    } catch (redisError) {
      console.warn(`⚠️ Redis cache invalidation failed:`, redisError.message);
    }

    // Check if campaign exists and belongs to user
    const [existingCampaign] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, user.id)))
      .limit(1);

    if (!existingCampaign) {
      return NextResponse.json(
        { error: "Campaign not found" },
        { status: 404 }
      );
    }

    // ✅ DB: Delete the campaign (leads and posts will be cascaded, ensure user owns it)
    await db
      .delete(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, user.id)));

    return NextResponse.json({
      success: true,
      message: "Campaign deleted successfully",
    });
  } catch (error) {
    console.error("Delete campaign error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
});