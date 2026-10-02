import { hash } from "bcryptjs";
import { db } from "@/libs/db";
import { users } from "@/libs/schema";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { nanoid } from "nanoid";

export async function POST(request) {
  try {
    const body = await request.json();
    const firstName = body.firstName?.trim();
    const lastName = body.lastName?.trim();
    const email = body.email?.trim().toLowerCase();
    const password = body.password;

    if (!firstName || !lastName || !email || !password) {
      return NextResponse.json(
        { error: "All fields are required" },
        { status: 400 }
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Please enter a valid email address" }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters long" },
        { status: 400 }
      );
    }

    // Emails are matched case-insensitively (older rows may be stored mixed-case)
    const existingUser = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`);

    if (existingUser.length > 0) {
      return NextResponse.json(
        { error: "User already exists with this email" },
        { status: 400 }
      );
    }

    const hashedPassword = await hash(password, 12);

    // Mode(s) are selected in the /onboarding wizard, not at signup.
    // role stays as sales_operator for backward-compat with role-gated middleware; admin is assigned manually.
    const userId = nanoid();
    const newUser = await db.insert(users).values({
      id: userId,
      email,
      name: `${firstName} ${lastName}`,
      password: hashedPassword,
      role: "sales_operator",
      modes: [],
    }).returning();
    
    return NextResponse.json(
      { 
        message: "User created successfully",
        user: {
          id: newUser[0].id,
          email: newUser[0].email,
          name: newUser[0].name,
        }
      },
      { status: 201 }
    );

  } catch (error) {
    console.error("Registration error:", error);
    const message = process.env.NODE_ENV === "development" ? error?.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
