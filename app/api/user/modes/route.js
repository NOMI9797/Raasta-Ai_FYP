import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/libs/next-auth";
import { db } from "@/libs/db";
import { users } from "@/libs/schema";
import { eq } from "drizzle-orm";

const ALLOWED_MODES = ["recruiter", "sales"];

function sanitizeModes(raw) {
  if (!Array.isArray(raw)) return [];
  const cleaned = raw
    .filter((m) => typeof m === "string")
    .map((m) => m.trim().toLowerCase())
    .filter((m) => ALLOWED_MODES.includes(m));
  return Array.from(new Set(cleaned));
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await db
    .select({ modes: users.modes, role: users.role })
    .from(users)
    .where(eq(users.id, session.user.id));
  const modes = Array.isArray(rows[0]?.modes) ? rows[0].modes : [];
  return NextResponse.json({ modes, role: rows[0]?.role ?? "sales_operator" });
}

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const modes = sanitizeModes(body?.modes);
  if (modes.length === 0) {
    return NextResponse.json(
      { error: "Pick at least one mode (recruiter or sales)" },
      { status: 400 }
    );
  }
  await db
    .update(users)
    .set({ modes, updatedAt: new Date() })
    .where(eq(users.id, session.user.id));
  return NextResponse.json({ success: true, modes });
}
