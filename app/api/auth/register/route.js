import { hash } from "bcryptjs";
import { db } from "@/libs/db";
import { users } from "@/libs/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { nanoid } from "nanoid";

export async function POST(request) {
  try {
    const { firstName, lastName, email, password } = await request.json();

    // Validate input
    if (!firstName || !lastName || !email || !password) {
      return NextResponse.json(
        { error: "All fields are required" },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await db.select().from(users).where(eq(users.email, email));
    
    if (existingUser.length > 0) {
      return NextResponse.json(
        { error: "User already exists with this email" },
        { status: 400 }
      );
    }

    // Hash password
    const hashedPassword = await hash(password, 12);
    
    console.log("Attempting to create user with:", {
      id: nanoid(),
      email,
      name: `${firstName} ${lastName}`,
      passwordLength: hashedPassword.length,
      hashedPassword: hashedPassword.substring(0, 20) + "...", // Log partial hash for debugging
    });

    // Create user (default role: sales_operator)
    const userId = nanoid();
    const newUser = await db.insert(users).values({
      id: userId,
      email,
      name: `${firstName} ${lastName}`,
      password: hashedPassword,
      role: "sales_operator",
    }).returning();
    
    console.log("User created:", newUser);
    
    // Let's also verify the password was actually stored by querying back
    const verifyUser = await db.select().from(users).where(eq(users.id, userId));
    console.log("User verification (should show password):", verifyUser);

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
