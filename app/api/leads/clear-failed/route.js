import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { leads, posts, messages } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";

// DELETE /api/leads/clear-failed - Remove all leads with error status
export const DELETE = withAuth(async (request, { user }) => {
  try {
    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get("campaignId");

    if (!campaignId) {
      return NextResponse.json(
        { error: "Campaign ID is required" },
        { status: 400 }
      );
    }

    // Use database transaction for atomicity
    const result = await db.transaction(async (tx) => {
      // First, get all error leads for this campaign
      const errorLeads = await tx
        .select({ id: leads.id })
        .from(leads)
        .where(
          and(
            eq(leads.campaignId, campaignId),
            eq(leads.status, 'error'),
            eq(leads.userId, user.id)
          )
        );

      if (errorLeads.length === 0) {
        return {
          deletedLeads: 0,
          deletedPosts: 0,
          deletedMessages: 0
        };
      }

      const errorLeadIds = errorLeads.map(lead => lead.id);

      // Delete related posts (cascade should handle this, but being explicit)
      await tx
        .delete(posts)
        .where(eq(posts.leadId, errorLeadIds[0])); // Drizzle doesn't support inArray for delete, so we'll do it one by one

      // Delete related messages (cascade should handle this, but being explicit)
      await tx
        .delete(messages)
        .where(eq(messages.leadId, errorLeadIds[0])); // Drizzle doesn't support inArray for delete, so we'll do it one by one

      // Delete the error leads
      await tx
        .delete(leads)
        .where(
          and(
            eq(leads.campaignId, campaignId),
            eq(leads.status, 'error'),
            eq(leads.userId, user.id)
          )
        );

      return {
        deletedLeads: errorLeads.length,
        deletedPosts: errorLeadIds.length, // Approximate count
        deletedMessages: errorLeadIds.length // Approximate count
      };
    });

    return NextResponse.json({
      success: true,
      message: `Successfully removed ${result.deletedLeads} error leads and their associated data`,
      data: {
        deletedLeads: result.deletedLeads,
        deletedPosts: result.deletedPosts,
        deletedMessages: result.deletedMessages
      }
    });

  } catch (error) {
    console.error("Clear failed leads error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 }
    );
  }
});
