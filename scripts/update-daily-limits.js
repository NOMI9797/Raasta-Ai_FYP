/**
 * Simple Migration Script: Update LinkedIn Accounts Daily Limits
 * 
 * This script updates all LinkedIn accounts to have a maximum daily limit of 30 invites.
 * Uses the same database connection pattern as API routes.
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';

// Database connection (same as libs/db.ts)
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('❌ DATABASE_URL environment variable is required');
  process.exit(1);
}

const client = postgres(connectionString);
const db = drizzle(client);

async function updateDailyLimits() {
  console.log('🚀 Starting migration: Update LinkedIn accounts daily limits');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  try {
    // Test connection first
    console.log('🔍 Testing database connection...');
    await db.execute(sql`SELECT 1`);
    console.log('✅ Database connection successful!');
    
    // Check total accounts
    console.log('\n📊 Checking current state...');
    const totalResult = await db.execute(sql`SELECT COUNT(*) as count FROM linkedin_accounts`);
    const totalCount = totalResult[0]?.count || 0;
    console.log(`📈 Total LinkedIn accounts in database: ${totalCount}`);
    
    if (totalCount === 0) {
      console.log('✅ No LinkedIn accounts found in database');
      console.log('🎉 No migration needed!');
      process.exit(0);
    }
    
    // Find accounts that need updating (anything not equal to 30)
    const accountsToUpdate = await db.execute(sql`
      SELECT id, email, daily_limit 
      FROM linkedin_accounts 
      WHERE daily_limit != 30 OR daily_limit IS NULL
    `);
    
    if (accountsToUpdate.length === 0) {
      console.log('✅ All accounts already have daily_limit = 30');
      console.log('🎉 No migration needed!');
      process.exit(0);
    }
    
    console.log(`\n📋 Found ${accountsToUpdate.length} account(s) that need updating:`);
    accountsToUpdate.forEach((account, index) => {
      console.log(`   ${index + 1}. ${account.email} (current limit: ${account.daily_limit || 'NULL'})`);
    });
    
    // Confirm migration
    console.log('\n⚠️  About to standardize ALL accounts to daily_limit = 30');
    console.log('⏳ Proceeding with migration in 2 seconds...\n');
    
    // Wait 2 seconds to allow cancellation (Ctrl+C)
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Perform the update
    console.log('🔄 Standardizing all accounts to limit = 30...');
    
    const result = await db.execute(sql`
      UPDATE linkedin_accounts 
      SET daily_limit = 30, updated_at = NOW()
      WHERE daily_limit != 30 OR daily_limit IS NULL
      RETURNING id, email, daily_limit
    `);

    console.log(`\n✅ Successfully updated ${result.length} account(s):`);
    result.forEach((account, index) => {
      console.log(`   ${index + 1}. ${account.email} → daily_limit = ${account.daily_limit}`);
    });
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✨ Migration completed successfully!');
    console.log('🎯 All LinkedIn accounts now have daily_limit ≤ 30');
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ Migration failed!');
    console.error('Error:', error.message);
    console.error('\nStack trace:');
    console.error(error.stack);
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    process.exit(1);
  } finally {
    // Close database connection
    await client.end();
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n\n⚠️  Migration cancelled by user');
  process.exit(0);
});

// Run the migration
updateDailyLimits();
