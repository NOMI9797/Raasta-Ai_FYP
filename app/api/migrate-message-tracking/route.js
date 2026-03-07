import { NextResponse } from 'next/server';
import { db } from '@/libs/db';
import { sql } from 'drizzle-orm';

export async function POST(request) {
  try {
    console.log('🚀 Starting message tracking migration...');
    
    // Add message tracking fields to leads table
    const migrations = [
      {
        name: 'Add message_sent to leads',
        sql: `ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "message_sent" boolean DEFAULT false NOT NULL`
      },
      {
        name: 'Add message_sent_at to leads',
        sql: `ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "message_sent_at" timestamp`
      },
      {
        name: 'Add message_error to leads',
        sql: `ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "message_error" text`
      },
      {
        name: 'Add daily_messages_sent to linkedin_accounts',
        sql: `ALTER TABLE "linkedin_accounts" ADD COLUMN IF NOT EXISTS "daily_messages_sent" integer DEFAULT 0 NOT NULL`
      },
      {
        name: 'Add daily_message_limit to linkedin_accounts',
        sql: `ALTER TABLE "linkedin_accounts" ADD COLUMN IF NOT EXISTS "daily_message_limit" integer DEFAULT 10 NOT NULL`
      },
      {
        name: 'Add last_message_reset to linkedin_accounts',
        sql: `ALTER TABLE "linkedin_accounts" ADD COLUMN IF NOT EXISTS "last_message_reset" timestamp DEFAULT now() NOT NULL`
      }
    ];

    const results = [];

    for (const migration of migrations) {
      console.log(`Executing: ${migration.name}...`);
      try {
        await db.execute(sql.raw(migration.sql));
        console.log(`✅ ${migration.name} - Success`);
        results.push({ name: migration.name, status: 'success' });
      } catch (error) {
        console.log(`⚠️ ${migration.name} - ${error.message}`);
        results.push({ name: migration.name, status: 'error', error: error.message });
      }
    }

    console.log('\n✅ Migration completed!');
    
    return NextResponse.json({
      success: true,
      message: 'Migration completed',
      results
    });
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Migration failed', 
        details: error.message 
      },
      { status: 500 }
    );
  }
}

