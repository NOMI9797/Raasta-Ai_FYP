/**
 * GET /api/linkedin/connections/check-schedule
 * 
 * Scheduled endpoint for automated connection checking (triggered by cron)
 * Checks all active LinkedIn accounts that haven't reached daily limit
 * Protected by cron secret token
 */

import { NextResponse } from "next/server";
import LinkedInSessionManager from "@/libs/linkedin-session";
import { db } from "@/libs/db";
import { linkedinAccounts } from "@/libs/schema";
import { eq } from "drizzle-orm";
import { checkDailyConnectionCheckLimit, incrementConnectionCheckCounter } from "@/libs/rate-limit-manager";
import { checkConnectionAcceptances } from "@/libs/linkedin-connection-checker";

const sessionManager = new LinkedInSessionManager();

export const GET = async (request) => {
  try {
    // STEP 1: Verify cron secret (security)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET || 'dev-cron-secret-change-in-production';
    
    if (authHeader !== `Bearer ${cronSecret}`) {
      console.error('❌ Unauthorized cron request');
      return NextResponse.json({
        success: false,
        error: 'Unauthorized'
      }, { status: 401 });
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🤖 AUTOMATED CONNECTION CHECK (Cron)`);
    console.log(`${'='.repeat(60)}`);
    console.log(`⏰ Time: ${new Date().toISOString()}\n`);
    
    // STEP 2: Fetch all active LinkedIn accounts
    console.log('📥 STEP 1: Fetching active LinkedIn accounts...');
    const allAccounts = await db
      .select()
      .from(linkedinAccounts)
      .where(eq(linkedinAccounts.isActive, true));
    
    console.log(`✅ Found ${allAccounts.length} active account(s)\n`);
    
    if (allAccounts.length === 0) {
      console.log('⚠️ No active accounts found');
      return NextResponse.json({
        success: true,
        message: 'No active accounts to check',
        checked: 0
      });
    }
    
    // STEP 3: Check each account that hasn't reached limit
    const results = [];
    let successCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (const account of allAccounts) {
      try {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`👤 Processing account: ${account.email}`);
        console.log(`${'='.repeat(60)}\n`);
        
        // Check if account can perform check
        const limitCheck = await checkDailyConnectionCheckLimit(account.id);
        
        if (!limitCheck.canCheck) {
          console.log(`⏭️ SKIPPED: Daily limit reached (${limitCheck.checked}/${limitCheck.limit})\n`);
          skippedCount++;
          results.push({
            accountEmail: account.email,
            status: 'skipped',
            reason: 'Daily limit reached',
            checked: limitCheck.checked,
            limit: limitCheck.limit
          });
          continue;
        }
        
        console.log(`✅ Limit check passed: ${limitCheck.remaining} checks remaining`);
        
        // Perform connection check
        const checkResult = await checkConnectionAcceptances(account, account.userId);
        
        if (checkResult.success) {
          // Increment counter
          await incrementConnectionCheckCounter(account.id);
          successCount++;
          
          results.push({
            accountEmail: account.email,
            status: 'success',
            ...checkResult,
            checksRemaining: limitCheck.remaining - 1
          });
          
          console.log(`✅ Check complete for ${account.email}: ${checkResult.matched} matched\n`);
        } else {
          errorCount++;
          results.push({
            accountEmail: account.email,
            status: 'error',
            error: 'Check failed'
          });
        }
        
      } catch (accountError) {
        console.error(`❌ Error processing account ${account.email}:`, accountError);
        errorCount++;
        results.push({
          accountEmail: account.email,
          status: 'error',
          error: accountError.message
        });
      }
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🎉 AUTOMATED CHECK COMPLETE`);
    console.log(`${'='.repeat(60)}`);
    console.log(`✅ Successful: ${successCount}`);
    console.log(`⏭️ Skipped (limit): ${skippedCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log(`${'='.repeat(60)}\n`);
    
    return NextResponse.json({
      success: true,
      summary: {
        total: allAccounts.length,
        successful: successCount,
        skipped: skippedCount,
        errors: errorCount
      },
      results
    });
    
  } catch (error) {
    console.error('❌ Scheduled check failed:', error);
    console.error('Stack:', error.stack);
    
    return NextResponse.json({
      success: false,
      error: error.message || 'Internal server error'
    }, { status: 500 });
  }
};

