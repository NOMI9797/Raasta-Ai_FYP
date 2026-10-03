import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/libs/db";
import { users } from "@/libs/schema";
import { withAuth } from "@/libs/auth-middleware";

const MAX_NAME = 100;

// PATCH /api/user/profile - update the signed-in user's display name
export const PATCH = withAuth(async (request, { user }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    if (name.length > MAX_NAME) {
      return NextResponse.json({ error: `Name must be ${MAX_NAME} characters or fewer` }, { status: 400 });
    }

    const [updated] = await db
      .update(users)
      .set({ name, updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .returning({ name: users.name });

    return NextResponse.json({ success: true, name: updated.name });
  } catch (error) {
    console.error("Update profile error:", error);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}, { requireUser: true });
