import { db } from "@/libs/db";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

// Public health check: reports only whether the database answers.
// Never return table rows here; this route has no auth.
export async function GET() {
  try {
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({ ok: true, message: "Database connection successful" });
  } catch (error) {
    console.error("Database test error:", error);
    return NextResponse.json(
      { ok: false, error: "Database test failed" },
      { status: 500 }
    );
  }
}
