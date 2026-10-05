import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { agentConfigs } from "@/libs/schema";
import { and, eq, desc } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { normaliseAgentConfig } from "@/libs/agent/config-validation";
import { RunError } from "@/libs/agent/launch";

export const GET = withAuth(async (request, { user }) => {
  try {
    // ?pipeline=recruiter | sales_operator lists one kind of agent; the hiring agent and the sales agent are separate
    const pipeline = new URL(request.url).searchParams.get("pipeline");
    const filters = [];
    if (user.role !== "admin") filters.push(eq(agentConfigs.userId, user.id));
    if (["recruiter", "sales_operator"].includes(pipeline)) filters.push(eq(agentConfigs.pipelineType, pipeline));
    const configs = await db
      .select()
      .from(agentConfigs)
      .where(filters.length ? and(...filters) : undefined)
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

    let normalised;
    try {
      normalised = normaliseAgentConfig(pipelineType, { mode: mode ?? null, config: config || {} });
    } catch (error) {
      if (error instanceof RunError) return NextResponse.json({ error: error.message }, { status: error.status });
      throw error;
    }

    const [created] = await db
      .insert(agentConfigs)
      .values({
        userId: user.id,
        pipelineType,
        name,
        mode: normalised.mode,
        config: normalised.config || {},
      })
      .returning();

    return NextResponse.json({ success: true, config: created }, { status: 201 });
  } catch (error) {
    console.error("Create agent config error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
