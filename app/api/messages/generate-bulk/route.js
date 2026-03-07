import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { leads, campaigns, posts, messages } from "@/libs/schema";
import { eq, and, isNull, desc, count } from "drizzle-orm";
import { generatePersonalizedMessage } from "@/libs/groq-service";
import { withAuth } from "@/libs/auth-middleware";

// POST /api/messages/generate-bulk - Generate messages for all completed leads
export const POST = withAuth(async (request, { user }) => {
  try {
    const { campaignId, leadIds, model, customPrompt } = await request.json();

    if (!campaignId) {
      return NextResponse.json(
        { error: "Campaign ID is required" },
        { status: 400 }
      );
    }

    // Verify campaign exists
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

    // Get completed leads that don't have messages yet
    let completedLeads;
    if (leadIds && Array.isArray(leadIds) && leadIds.length > 0) {
      // Generate for specific leads
      completedLeads = await db
        .select()
        .from(leads)
        .where(
          and(
            eq(leads.campaignId, campaignId),
            eq(leads.status, 'completed')
          )
        );
      
      // Filter to only include requested lead IDs
      completedLeads = completedLeads.filter(lead => leadIds.includes(lead.id));
    } else {
      // Get all completed leads without messages
      completedLeads = await db
        .select()
        .from(leads)
        .leftJoin(messages, eq(leads.id, messages.leadId))
        .where(
          and(
            eq(leads.campaignId, campaignId),
            eq(leads.status, 'completed'),
            isNull(messages.id) // No existing message
          )
        )
        .then(results => results.map(result => result.leads));
    }

    if (completedLeads.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No completed leads found that need message generation",
        data: {
          processed: 0,
          successful: 0,
          failed: 0,
          results: []
        }
      });
    }

    console.log(`Starting bulk message generation for ${completedLeads.length} leads`);

    // Process leads in batches to avoid rate limits
    const BATCH_SIZE = 5;
    const DELAY_BETWEEN_BATCHES = 2000; // 2 seconds
    const results = [];
    let successful = 0;
    let failed = 0;

    // Helper function to delay execution
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Process leads in batches
    for (let i = 0; i < completedLeads.length; i += BATCH_SIZE) {
      const batch = completedLeads.slice(i, i + BATCH_SIZE);
      console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(completedLeads.length / BATCH_SIZE)}`);

      // Process batch concurrently
      const batchPromises = batch.map(async (lead) => {
        try {
          // Get posts for this lead
          const leadPosts = await db
            .select()
            .from(posts)
            .where(eq(posts.leadId, lead.id))
            .orderBy(desc(posts.engagement), desc(posts.timestamp))
            .limit(5);

          if (leadPosts.length === 0) {
            return {
              leadId: lead.id,
              leadName: lead.name || "LinkedIn User",
              success: false,
              error: "No posts found for this lead"
            };
          }

          // Generate personalized message
          const messageContent = await generatePersonalizedMessage({
            leadName: lead.name || "LinkedIn User",
            leadTitle: lead.title,
            leadCompany: lead.company,
            posts: leadPosts.map(post => ({
              content: post.content,
              timestamp: post.timestamp.toISOString(),
              engagement: post.engagement
            })),
            customPrompt,
            model: model || "llama-3.1-8b-instant"
          });

          // Save message to database
          const [savedMessage] = await db
            .insert(messages)
            .values({
              leadId: lead.id,
              campaignId: campaignId,
              content: messageContent,
              model: model || "llama-3.1-8b-instant",
              customPrompt: customPrompt || null,
              postsAnalyzed: leadPosts.length,
              status: "draft",
            })
            .returning();

          return {
            leadId: lead.id,
            leadName: lead.name || "LinkedIn User",
            success: true,
            messageId: savedMessage.id,
            postsAnalyzed: leadPosts.length
          };

        } catch (error) {
          console.error(`Error generating message for lead ${lead.id}:`, error);
          return {
            leadId: lead.id,
            leadName: lead.name || "LinkedIn User",
            success: false,
            error: error.message || "Unknown error occurred"
          };
        }
      });

      // Wait for batch to complete
      const batchResults = await Promise.allSettled(batchPromises);
      
      // Process results
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
          if (result.value.success) {
            successful++;
          } else {
            failed++;
          }
        } else {
          const lead = batch[index];
          results.push({
            leadId: lead.id,
            leadName: lead.name || "LinkedIn User",
            success: false,
            error: result.reason?.message || "Promise rejected"
          });
          failed++;
        }
      });

      // Add delay between batches (except for the last batch)
      if (i + BATCH_SIZE < completedLeads.length) {
        await delay(DELAY_BETWEEN_BATCHES);
      }
    }

    console.log(`Bulk message generation completed: ${successful} successful, ${failed} failed`);

    return NextResponse.json({
      success: true,
      message: `Bulk message generation completed: ${successful} successful, ${failed} failed`,
      data: {
        processed: completedLeads.length,
        successful,
        failed,
        results
      }
    });

  } catch (error) {
    console.error("Bulk message generation error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 }
    );
  }
});

// GET /api/messages/generate-bulk - Get bulk generation status/statistics
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get("campaignId");

    if (!campaignId) {
      return NextResponse.json(
        { error: "Campaign ID is required" },
        { status: 400 }
      );
    }

    // Get statistics for the campaign
    await db
      .select({ count: count(leads.id) })
      .from(leads)
      .where(
        and(
          eq(leads.campaignId, campaignId),
          eq(leads.status, 'completed')
        )
      );

    const messagesCountResult = await db
      .select({ count: count(messages.id) })
      .from(messages)
      .where(eq(messages.campaignId, campaignId));

    const completedLeads = await db
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.campaignId, campaignId),
          eq(leads.status, 'completed')
        )
      );

    const leadsWithMessages = await db
      .select({ leadId: messages.leadId })
      .from(messages)
      .where(eq(messages.campaignId, campaignId));

    const leadsWithMessagesSet = new Set(leadsWithMessages.map(m => m.leadId));
    const leadsNeedingMessages = completedLeads.filter(lead => !leadsWithMessagesSet.has(lead.id));

    console.log('Bulk stats API:', {
      campaignId,
      totalCompletedLeads: completedLeads.length,
      totalMessages: messagesCountResult[0]?.count || 0,
      leadsNeedingMessages: leadsNeedingMessages.length,
      completedLeads: completedLeads.map(l => ({ id: l.id, name: l.name, status: l.status })),
      leadsWithMessages: leadsWithMessages.map(m => m.leadId)
    });

    return NextResponse.json({
      success: true,
      data: {
        totalCompletedLeads: completedLeads.length,
        totalMessages: messagesCountResult[0]?.count || 0,
        leadsNeedingMessages: leadsNeedingMessages.length,
        leadsNeedingMessagesList: leadsNeedingMessages.map(lead => ({
          id: lead.id,
          name: lead.name || "LinkedIn User",
          url: lead.url
        }))
      }
    });

  } catch (error) {
    console.error("Get bulk generation stats error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 }
    );
  }
}
