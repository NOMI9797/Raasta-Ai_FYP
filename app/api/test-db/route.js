import { db } from "@/libs/db";
import { users } from "@/libs/schema";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Test database connection and schema
    const testQuery = await db.select().from(users).limit(1);
    
    // Get table schema info
    const schemaQuery = `
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      ORDER BY ordinal_position;
    `;
    
    const result = await db.execute(schemaQuery);
    
    return NextResponse.json({
      message: "Database connection successful",
      userTableSchema: result.rows,
      sampleUsers: testQuery,
    });
    
  } catch (error) {
    console.error("Database test error:", error);
    return NextResponse.json(
      { 
        error: "Database test failed", 
        details: error.message 
      },
      { status: 500 }
    );
  }
}