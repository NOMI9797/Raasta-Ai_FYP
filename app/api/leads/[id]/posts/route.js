import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { leads, posts } from "@/libs/schema";
import { eq, desc, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";

// GET /api/leads/[id]/posts - Get posts for a lead (like Reachly)
export const GET = withAuth(async (request, { params, user }) => {
  try {
    const leadId = params.id;

    // Check if lead exists and belongs to user
    const [lead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.userId, user.id)))
      .limit(1);

    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // Get posts for this lead (user already verified via lead ownership)
    const leadPosts = await db
      .select()
      .from(posts)
      .where(and(eq(posts.leadId, leadId), eq(posts.userId, user.id)))
      .orderBy(desc(posts.timestamp));

    return NextResponse.json({
      success: true,
      posts: leadPosts
    });

  } catch (error) {
    console.error("Get posts error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
});

// POST /api/leads/[id]/posts - Save posts for a lead (like Reachly)
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const leadId = params.id;
    const { posts: postsData } = await request.json();

    if (!postsData || !Array.isArray(postsData)) {
      return NextResponse.json({ error: "Posts array is required" }, { status: 400 });
    }

    // Check if lead exists and belongs to user
    const [lead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.userId, user.id)))
      .limit(1);

    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // Helper function to safely convert to number
    const safeNumber = (value) => {
      if (Array.isArray(value)) return value.length;
      if (typeof value === 'number') return Math.max(0, value);
      if (typeof value === 'string') {
        const parsed = parseInt(value.replace(/[^\d]/g, ''));
        return isNaN(parsed) ? 0 : Math.max(0, parsed);
      }
      return 0;
    };

    // Delete existing posts for this lead (user already verified via lead ownership)
    await db.delete(posts).where(and(eq(posts.leadId, leadId), eq(posts.userId, user.id)));

    // Prepare posts data
    const postsToInsert = postsData.map(post => {
      const likes = safeNumber(post.numLikes || post.likes || post.likeCount);
      const comments = safeNumber(post.numComments || post.comments || post.commentCount);
      const shares = safeNumber(post.numShares || post.reposts || post.repostCount || post.shares);
      
      return {
        leadId: leadId,
        userId: user.id,
        content: post.content || post.text || post.description || 'No content available',
        timestamp: new Date(post.timestamp || post.date || post.createdAt || new Date()),
        likes: likes,
        comments: comments,
        shares: shares,
        engagement: likes + (comments * 2) + (shares * 3),
      };
    });

    // Save new posts
    const savedPosts = await db
      .insert(posts)
      .values(postsToInsert)
      .returning();

    return NextResponse.json({
      success: true,
      savedPosts: savedPosts.length,
      posts: savedPosts
    });

  } catch (error) {
    console.error("Save posts error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
});