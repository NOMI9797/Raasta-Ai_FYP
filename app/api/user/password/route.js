import { NextResponse } from "next/server";
import { compare, hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/libs/db";
import { users } from "@/libs/schema";
import { withAuth } from "@/libs/auth-middleware";

const MIN_LENGTH = 8;

// POST /api/user/password - change (or, for Google-only accounts, set) the password
export const POST = withAuth(async (request, { user }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

    if (newPassword.length < MIN_LENGTH) {
      return NextResponse.json(
        { error: `New password must be at least ${MIN_LENGTH} characters long` },
        { status: 400 }
      );
    }

    const [row] = await db
      .select({ password: users.password })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    // Accounts created with Google have no password yet; they may set one without a current password
    if (row?.password) {
      if (!currentPassword || !(await compare(currentPassword, row.password))) {
        return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
      }
      if (await compare(newPassword, row.password)) {
        return NextResponse.json(
          { error: "New password must be different from the current one" },
          { status: 400 }
        );
      }
    }

    await db
      .update(users)
      .set({ password: await hash(newPassword, 12), updatedAt: new Date() })
      .where(eq(users.id, user.id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Change password error:", error?.message);
    return NextResponse.json({ error: "Failed to change password" }, { status: 500 });
  }
}, { requireUser: true });
