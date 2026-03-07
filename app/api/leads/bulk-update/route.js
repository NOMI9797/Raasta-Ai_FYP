import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { leads, posts, campaigns, messages } from "@/libs/schema";
import { eq, inArray, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";

// POST /api/leads/bulk-update - Bulk update leads and their posts (authenticated user)
export const POST = withAuth(async (request, { user }) => {
  try {
    const { leadsData } = await request.json();

    if (!leadsData || !Array.isArray(leadsData)) {
      return NextResponse.json({ 
        error: "leadsData array is required" 
      }, { status: 400 });
    }

    if (leadsData.length === 0) {
      return NextResponse.json({ 
        success: true, 
        message: "No leads to update" 
      });
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

    // Use database transaction for atomicity
    const result = await db.transaction(async (tx) => {
      const leadIds = leadsData.map(lead => lead.leadId);
      
      // Verify all leads belong to the authenticated user
      const userLeads = await tx
        .select({ id: leads.id })
        .from(leads)
        .where(and(inArray(leads.id, leadIds), eq(leads.userId, user.id)));
      
      const userLeadIds = new Set(userLeads.map(lead => lead.id));
      const unauthorizedLeads = leadIds.filter(id => !userLeadIds.has(id));
      
      if (unauthorizedLeads.length > 0) {
        throw new Error(`Unauthorized access to leads: ${unauthorizedLeads.join(', ')}`);
      }
      
      const allPostsToInsert = [];
      const leadsToUpdate = [];

      // Process each lead's data
      for (const leadData of leadsData) {
        const { leadId, posts: postsData, status, name, title, company, location, profilePicture } = leadData;

        // Prepare lead update data
        const leadUpdateData = {
          status: status || 'completed',
          updatedAt: new Date(),
        };

        // Add optional fields if provided
        if (name) leadUpdateData.name = name;
        if (title) leadUpdateData.title = title;
        if (company) leadUpdateData.company = company;
        if (location) leadUpdateData.location = location;
        if (profilePicture) leadUpdateData.profilePicture = profilePicture;

        leadsToUpdate.push({ leadId, ...leadUpdateData });

        // Prepare posts data if provided
        if (postsData && Array.isArray(postsData) && postsData.length > 0) {
          const postsForLead = postsData.map(post => {
            const likes = safeNumber(post.numLikes || post.likes || post.likeCount);
            const comments = safeNumber(post.numComments || post.comments || post.commentCount);
            const shares = safeNumber(post.numShares || post.reposts || post.repostCount || post.shares);
            
            return {
              userId: user.id,
              leadId: leadId,
              content: post.content || post.text || post.description || 'No content available',
              timestamp: new Date(post.timestamp || post.date || post.createdAt || new Date()),
              likes: likes,
              comments: comments,
              shares: shares,
              engagement: likes + (comments * 2) + (shares * 3),
            };
          });

          allPostsToInsert.push(...postsForLead);
        }
      }

      // Step 1: Delete existing posts for all leads (batch operation, user-scoped)
      if (allPostsToInsert.length > 0) {
        await tx.delete(posts).where(and(inArray(posts.leadId, leadIds), eq(posts.userId, user.id)));
      }

      // Step 2: Insert all new posts (batch operation)
      if (allPostsToInsert.length > 0) {
        await tx.insert(posts).values(allPostsToInsert);
      }

      // Step 3: Update all leads (batch operation)
      const updatedLeads = [];
      for (const leadUpdate of leadsToUpdate) {
        const { leadId, ...updateData } = leadUpdate;
        const [updatedLead] = await tx
          .update(leads)
          .set(updateData)
          .where(and(eq(leads.id, leadId), eq(leads.userId, user.id)))
          .returning();
        updatedLeads.push(updatedLead);
      }

      return {
        updatedLeads,
        postsInserted: allPostsToInsert.length,
        leadsUpdated: leadsToUpdate.length
      };
    });

    console.log(`✅ BULK UPDATE: Successfully updated ${result.leadsUpdated} leads and inserted ${result.postsInserted} posts`);

    // Refresh Redis cache for affected campaigns after bulk update
    const campaignIds = [...new Set(result.updatedLeads.map(lead => lead.campaignId))];
    console.log(`🔄 CACHE REFRESH: Triggering cache refresh for ${campaignIds.length} campaigns after bulk update`);
    
    // Import the refresh cache logic directly to avoid auth issues
    const getRedisClient = require('@/libs/redis').default;
    const redis = getRedisClient();
    
    for (const campaignId of campaignIds) {
      try {
        console.log(`🔄 CACHE REFRESH: Refreshing cache for campaign ${campaignId}`);
        
        // Fetch fresh campaign data from DB (user-filtered)
        const [campaign] = await db.select()
          .from(campaigns)
          .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, user.id)))
          .limit(1);
          
        if (!campaign) {
          console.log(`⚠️ CACHE REFRESH: Campaign ${campaignId} not found or not owned by user`);
          continue;
        }
        
        const campaignLeads = await db.select()
          .from(leads)
          .where(and(eq(leads.campaignId, campaignId), eq(leads.userId, user.id)));
          
        const campaignMessages = await db.select()
          .from(messages)
          .where(and(eq(messages.campaignId, campaignId), eq(messages.userId, user.id)));
        
        // Update campaign data in Redis
        await redis.hset(`campaign:${campaignId}:data`, {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          leadsCount: campaignLeads.length,
          messagesCount: campaignMessages.length,
          lastUpdated: Date.now()
        });
        
        // Update leads in Redis with hasMessage status
        if (campaignLeads.length > 0) {
          const leadsData = {};
          const leadsWithMessages = new Set(campaignMessages.map(msg => msg.leadId));
          
          campaignLeads.forEach(lead => {
            const hasMessage = leadsWithMessages.has(lead.id);
            
            leadsData[lead.id] = JSON.stringify({
              id: lead.id,
              name: lead.name,
              title: lead.title,
              company: lead.company,
              url: lead.url,
              status: lead.status,
              hasMessage: hasMessage
            });
          });
          
          await redis.hset(`campaign:${campaignId}:leads`, leadsData);
        }
        
        console.log(`✅ CACHE REFRESH: Successfully refreshed cache for campaign ${campaignId}: ${campaignLeads.length} leads cached`);
      } catch (error) {
        console.log(`❌ CACHE REFRESH: Error refreshing cache for campaign ${campaignId}:`, error.message);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Successfully updated ${result.leadsUpdated} leads and inserted ${result.postsInserted} posts`,
      data: {
        leadsUpdated: result.leadsUpdated,
        postsInserted: result.postsInserted,
        updatedLeads: result.updatedLeads
      }
    });

  } catch (error) {
    console.error("Bulk update error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 }
    );
  }
});
