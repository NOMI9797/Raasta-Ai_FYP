/**
 * POST /api/linkedin/connections/check-acceptance
 * 
 * Manual trigger for checking connection acceptances
 * Validates user, checks daily limit, scrapes connections page, and updates matched leads
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import LinkedInSessionManager from "@/libs/linkedin-session";
import { checkDailyConnectionCheckLimit, incrementConnectionCheckCounter } from "@/libs/rate-limit-manager";
import { checkConnectionAcceptances } from "@/libs/linkedin-connection-checker";

const sessionManager = new LinkedInSessionManager();

export const POST = withAuth(async (request, { user }) => {
  try {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔍 CONNECTION CHECK REQUEST (Manual)`);
    console.log(`${'='.repeat(60)}`);
    console.log(`👤 User: ${user.email} (${user.id})\n`);
    
    // STEP 1: Get active LinkedIn account
    console.log('🔐 STEP 1: Finding active LinkedIn account...');
    const allAccounts = await sessionManager.getAllSessions(user.id);
    const activeAccount = allAccounts.find(acc => acc.isActive);
    
    if (!activeAccount) {
      console.error('❌ No active LinkedIn account found');
      return NextResponse.json({
        success: false,
        error: 'No active LinkedIn account found. Please connect a LinkedIn account first.'
      }, { status: 400 });
    }
    
    console.log(`✅ Active account: ${activeAccount.email}\n`);
    
    // STEP 2: Check daily limit (max 3 checks per day)
    console.log('📊 STEP 2: Checking daily limit...');
    const limitCheck = await checkDailyConnectionCheckLimit(activeAccount.id);
    
    console.log(`📊 Connection checks today: ${limitCheck.checked}/${limitCheck.limit}`);
    console.log(`📊 Remaining: ${limitCheck.remaining}`);
    
    if (!limitCheck.canCheck) {
      const resetsIn = Math.ceil((limitCheck.resetsAt - new Date()) / (1000 * 60 * 60));
      console.error(`❌ Daily limit reached (${limitCheck.limit} checks per day)`);
      
      return NextResponse.json({
        success: false,
        error: `Daily connection check limit reached (${limitCheck.limit} per day). Resets in ${resetsIn} hours.`,
        limit: limitCheck.limit,
        checked: limitCheck.checked,
        remaining: limitCheck.remaining,
        resetsAt: limitCheck.resetsAt
      }, { status: 429 });
    }
    
    console.log(`✅ Limit check passed: ${limitCheck.remaining} checks remaining\n`);
    
    // STEP 3: Perform connection acceptance check
    console.log('🚀 STEP 3: Starting connection acceptance check...\n');
    
    const results = await checkConnectionAcceptances(activeAccount, user.id);
    
    // STEP 4: Increment daily counter
    if (results.success) {
      await incrementConnectionCheckCounter(activeAccount.id);
      console.log('✅ Daily counter incremented\n');
    }
    
    console.log(`${'='.repeat(60)}`);
    console.log(`🎉 CHECK COMPLETE`);
    console.log(`${'='.repeat(60)}\n`);
    
    return NextResponse.json({
      success: true,
      ...results,
      checksRemaining: limitCheck.remaining - 1,
      checksLimit: limitCheck.limit
    });
    
  } catch (error) {
    console.error('❌ Connection check failed:', error);
    console.error('Stack:', error.stack);
    
    return NextResponse.json({
      success: false,
      error: error.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
});

