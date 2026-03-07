import { db } from "@/libs/db";
import { users } from "@/libs/schema";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Check what columns Drizzle thinks the users table has
    const userSchema = users;
    
    // Get actual database schema
    const schemaResult = await db.execute(`
      SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      ORDER BY ordinal_position;
    `);
    
    // Try a raw SQL insert to test if password column exists
    const testId = `test-${Date.now()}`;
    const testEmail = `test-${Date.now()}@example.com`;
    
    try {
      await db.execute(`
        INSERT INTO users (id, email, name, password) 
        VALUES ($1, $2, $3, $4)
      `, [testId, testEmail, 'Test User', '$2b$12$testhash']);
      
      // Query back to see if it worked
      const testResult = await db.execute(`
        SELECT id, email, name, password FROM users WHERE id = $1
      `, [testId]);
      
      // Clean up test user
      await db.execute(`DELETE FROM users WHERE id = $1`, [testId]);
      
      return NextResponse.json({
        schemaColumns: schemaResult.rows,
        drizzleSchema: Object.keys(userSchema),
        rawSqlTest: testResult.rows[0],
        testPassed: true
      });
      
    } catch (sqlError) {
      return NextResponse.json({
        schemaColumns: schemaResult.rows,
        drizzleSchema: Object.keys(userSchema),
        rawSqlError: sqlError.message,
        testPassed: false
      });
    }
    
  } catch (error) {
    console.error("Debug schema error:", error);
    return NextResponse.json(
      { 
        error: "Debug failed", 
        details: error.message 
      },
      { status: 500 }
    );
  }
}
