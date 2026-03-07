import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { leads } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";

// GET /api/leads/[id] - Get a specific lead (authenticated user)
export const GET = withAuth(async (request, { params, user }) => {
  try {
    const leadId = params.id;

    const [lead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.userId, user.id)))
      .limit(1);

    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      lead: lead
    });

  } catch (error) {
    console.error("Get lead error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
});

// PUT /api/leads/[id] - Update a lead (authenticated user)
export const PUT = withAuth(async (request, { params, user }) => {
  try {
    const leadId = params.id;
    const updateData = await request.json();

    // Check if lead exists and belongs to user
    const [existingLead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.userId, user.id)))
      .limit(1);

    if (!existingLead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // Update the lead (ensure user owns it)
    const [updatedLead] = await db
      .update(leads)
      .set({
        ...updateData,
        updatedAt: new Date(),
      })
      .where(and(eq(leads.id, leadId), eq(leads.userId, user.id)))
      .returning();

    return NextResponse.json({
      success: true,
      lead: updatedLead
    });

  } catch (error) {
    console.error("Update lead error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
});

// DELETE /api/leads/[id] - Delete a lead (authenticated user)
export const DELETE = withAuth(async (request, { params, user }) => {
  try {
    const leadId = params.id;

    // Check if lead exists and belongs to user
    const [existingLead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.userId, user.id)))
      .limit(1);

    if (!existingLead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // Delete the lead (posts and messages will be cascaded, ensure user owns it)
    await db.delete(leads).where(and(eq(leads.id, leadId), eq(leads.userId, user.id)));

    return NextResponse.json({
      success: true,
      message: "Lead deleted successfully"
    });

  } catch (error) {
    console.error("Delete lead error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
});