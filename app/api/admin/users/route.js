import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { users } from "@/libs/schema";
import { eq } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";

const ALLOWED_ROLES = ["admin", "sales_operator", "recruiter"];

// GET /api/admin/users - list all users (admin only)
export const GET = withAuth(async (request, { user }) => {
  if (user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const allUsers = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      subscriptionStatus: users.subscriptionStatus,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(users.createdAt);

  return NextResponse.json({ users: allUsers });
}, { requireUser: true });

// PATCH /api/admin/users - update a user's role (admin only)
export const PATCH = withAuth(async (request, { user }) => {
  if (user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const userId = body?.userId;
  const role = body?.role;

  if (!userId || !role) {
    return NextResponse.json(
      { error: "userId and role are required" },
      { status: 400 }
    );
  }

  if (!ALLOWED_ROLES.includes(role)) {
    return NextResponse.json(
      { error: "Invalid role value" },
      { status: 400 }
    );
  }

  const [updated] = await db
    .update(users)
    .set({
      role,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      subscriptionStatus: users.subscriptionStatus,
      createdAt: users.createdAt,
    });

  if (!updated) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ user: updated });
}, { requireUser: true });

