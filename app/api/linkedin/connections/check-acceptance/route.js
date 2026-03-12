/**
 * POST /api/linkedin/connections/check-acceptance
 * 
 * Manual trigger for checking connection acceptances
 * Validates user, checks daily limit, scrapes connections page, and updates matched leads
 */

import { NextResponse } from "next/server";
import { authenticateUser } from "@/libs/auth-middleware";
import LinkedInSessionManager from "@/libs/linkedin-session";
import { checkDailyConnectionCheckLimit, incrementConnectionCheckCounter } from "@/libs/rate-limit-manager";
import { checkConnectionAcceptances } from "@/libs/linkedin-connection-checker";
import { db } from "@/libs/db";
import { linkedinAccounts, users } from "@/libs/schema";
import { eq } from "drizzle-orm";

const sessionManager = new LinkedInSessionManager();

async function resolveUserForRequest(request) {
  const internalToken = request.headers.get("x-internal-agent-token");
  const expected = process.env.INTERNAL_AGENT_TOKEN;

  if (internalToken && expected && internalToken === expected) {
    const body = await request.json().catch(() => ({}));
    if (!body?.userId) {
      return { ok: false, status: 400, error: "userId is required for internal agent calls" };
    }
    const [dbUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, body.userId))
      .limit(1);
    if (!dbUser) {
      return { ok: false, status: 404, error: "User not found" };
    }
    return { ok: true, user: dbUser, body };
  }

  const { user, isAuthenticated, error } = await authenticateUser(request);
  if (!isAuthenticated) {
    return { ok: false, status: 401, error: error || "Not authenticated" };
  }
  return { ok: true, user, body: null };
}

export async function POST(request) {
  try {
    const resolved = await resolveUserForRequest(request);
    if (!resolved.ok) {
      return NextResponse.json({ success: false, error: resolved.error }, { status: resolved.status });
    }
    const user = resolved.user;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔍 CONNECTION CHECK REQUEST (Manual)`);
    console.log(`${'='.repeat(60)}`);
    console.log(`👤 User: ${user.email} (${user.id})\n`);
    
    // STEP 1: Get active LinkedIn account
    console.log('🔐 STEP 1: Finding active LinkedIn account...');
    const allAccounts = await sessionManager.getAllSessions(user.id);
    let activeAccount =
      allAccounts.find((acc) => acc.isActive === true) ||
      allAccounts[0] ||
      null;

    // If Sales Operator / Recruiter doesn't have their own active account,
    // allow using the globally-active (admin-connected) account.
    if (!activeAccount && (user.role === "sales_operator" || user.role === "recruiter")) {
      console.log(`🔁 No user-scoped account found; trying shared active account...`);
      const [sharedActive] = await db
        .select()
        .from(linkedinAccounts)
        .where(eq(linkedinAccounts.isActive, true))
        .limit(1);
      activeAccount = sharedActive || null;
    }
    
    if (!activeAccount) {
      console.error('❌ No active LinkedIn account found');
      return NextResponse.json({
        success: false,
        error: 'No LinkedIn account found. Please connect a LinkedIn account first.'
      }, { status: 400 });
    }
    
    if (activeAccount.userId === user.id && !activeAccount.isActive) {
      console.log(`⚠️ No active account set. Falling back to most recent account: ${activeAccount.email}`);
      // Best-effort: mark it active so future calls are consistent
      await sessionManager.updateSessionStatus(activeAccount.sessionId, { isActive: true }).catch(() => {});
    }

    console.log(`✅ Using account: ${activeAccount.email}\n`);
    
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
}

