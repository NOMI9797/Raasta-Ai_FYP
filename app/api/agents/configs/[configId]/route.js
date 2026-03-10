import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { agentConfigs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";

export const GET = withAuth(async (request, { user, params }) => {
  try {
    const { configId } = await params;
    const isAdmin = user.role === "admin";

    const [config] = isAdmin
      ? await db.select().from(agentConfigs).where(eq(agentConfigs.id, configId)).limit(1)
      : await db
          .select()
          .from(agentConfigs)
          .where(and(eq(agentConfigs.id, configId), eq(agentConfigs.userId, user.id)))
          .limit(1);

    if (!config) {
      return NextResponse.json({ error: "Config not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, config });
  } catch (error) {
    console.error("Get agent config error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });

export const PATCH = withAuth(async (request, { user, params }) => {
  try {
    const { configId } = await params;
    const body = await request.json();
    const isAdmin = user.role === "admin";

    const ownerFilter = isAdmin
      ? eq(agentConfigs.id, configId)
      : and(eq(agentConfigs.id, configId), eq(agentConfigs.userId, user.id));

    const [existing] = await db.select().from(agentConfigs).where(ownerFilter).limit(1);
    if (!existing) {
      return NextResponse.json({ error: "Config not found" }, { status: 404 });
    }

    const updates = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.mode !== undefined) updates.mode = body.mode;
    if (body.config !== undefined) updates.config = body.config;
    if (body.isActive !== undefined) updates.isActive = body.isActive;
    updates.updatedAt = new Date();

    const [updated] = await db
      .update(agentConfigs)
      .set(updates)
      .where(eq(agentConfigs.id, configId))
      .returning();

    return NextResponse.json({ success: true, config: updated });
  } catch (error) {
    console.error("Update agent config error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });

export const DELETE = withAuth(async (request, { user, params }) => {
  try {
    const { configId } = await params;
    const isAdmin = user.role === "admin";

    const ownerFilter = isAdmin
      ? eq(agentConfigs.id, configId)
      : and(eq(agentConfigs.id, configId), eq(agentConfigs.userId, user.id));

    const [existing] = await db.select().from(agentConfigs).where(ownerFilter).limit(1);
    if (!existing) {
      return NextResponse.json({ error: "Config not found" }, { status: 404 });
    }

    await db.delete(agentConfigs).where(eq(agentConfigs.id, configId));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete agent config error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
