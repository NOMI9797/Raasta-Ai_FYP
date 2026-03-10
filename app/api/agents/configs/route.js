import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { agentConfigs } from "@/libs/schema";
import { eq, desc } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";

export const GET = withAuth(async (request, { user }) => {
  try {
    const isAdmin = user.role === "admin";
    const configs = isAdmin
      ? await db.select().from(agentConfigs).orderBy(desc(agentConfigs.createdAt))
      : await db
          .select()
          .from(agentConfigs)
          .where(eq(agentConfigs.userId, user.id))
          .orderBy(desc(agentConfigs.createdAt));

    return NextResponse.json({ success: true, configs });
  } catch (error) {
    console.error("List agent configs error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });

export const POST = withAuth(async (request, { user }) => {
  try {
    const body = await request.json();
    const { pipelineType, name, mode, config } = body;

    if (!pipelineType || !name) {
      return NextResponse.json({ error: "pipelineType and name are required" }, { status: 400 });
    }

    if (!["recruiter", "sales_operator"].includes(pipelineType)) {
      return NextResponse.json({ error: "Invalid pipeline type" }, { status: 400 });
    }

    const [created] = await db
      .insert(agentConfigs)
      .values({
        userId: user.id,
        pipelineType,
        name,
        mode: mode || "semi_auto",
        config: config || {},
      })
      .returning();

    return NextResponse.json({ success: true, config: created }, { status: 201 });
  } catch (error) {
    console.error("Create agent config error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
