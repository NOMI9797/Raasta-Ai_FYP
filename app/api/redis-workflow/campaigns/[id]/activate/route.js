/**
 * Campaign Activation Endpoint
 * 
 * POST /api/redis-workflow/campaigns/[id]/activate
 * 
 * Orchestrates the complete workflow:
 * 1. Validate campaign and LinkedIn account
 * 2. Test session validity
 * 3. Fetch eligible leads
 * 4. Process invites directly using validated browser
 * 5. Return comprehensive results
 */

import { NextResponse } from "next/server";
import LinkedInSessionManager from "@/libs/linkedin-session";
import { withAuth } from "@/libs/auth-middleware";
import { db } from "@/libs/db";
import { campaigns } from "@/libs/schema";
import { eq, and } from "drizzle-orm";

// Import refactored modules
import { testLinkedInSession, cleanupBrowserSession } from "@/libs/linkedin-session-validator";
import { fetchEligibleLeads, getLeadAnalytics } from "@/libs/lead-status-manager";
import { processInvitesDirectly } from "@/libs/linkedin-invite-automation";

const sessionManager = new LinkedInSessionManager();

/**
 * Main POST handler - Campaign Activation
 */
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const { id: campaignId } = params;
    const { 
      linkedinAccountId, 
      customMessage = "Hi there! I'd like to connect with you.",
      batchSize = 5 
    } = await request.json();

    console.log(`🚀 CAMPAIGN ACTIVATION: Starting activation for campaign ${campaignId}`);
    console.log(`👤 User: ${user.id}`);

    // Validate required parameters
    if (!campaignId) {
      return NextResponse.json(
        { error: "Campaign ID is required" },
        { status: 400 }
      );
    }

    // ============================================================
    // STEP 1: Validate Campaign
    // ============================================================
    console.log(`📋 STEP 1: Validating campaign ownership...`);
    
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, user.id)))
      .limit(1);

    if (!campaign) {
      return NextResponse.json(
        { 
          error: "CAMPAIGN_NOT_FOUND",
          message: "Campaign not found or does not belong to user" 
        },
        { status: 404 }
      );
    }

    console.log(`✅ Campaign validated: ${campaign.name} (${campaign.status})`);

    // ============================================================
    // STEP 2: Validate LinkedIn Account
    // ============================================================
    console.log(`🔐 STEP 2: Finding active LinkedIn account...`);
    
    let accountData = null;
    let activeAccountId = linkedinAccountId;

    // If no specific account provided, find the active one for this user
    if (!linkedinAccountId) {
      console.log(`🔍 No specific account provided, finding active account for user...`);
      
      const allAccounts = await sessionManager.getAllSessions(user.id);
      const activeAccount = allAccounts.find(account => account.isActive === true);
      
      if (!activeAccount) {
        return NextResponse.json(
          { 
            error: "NO_ACTIVE_ACCOUNT",
            message: "No active LinkedIn account found. Please activate a LinkedIn account first." 
          },
          { status: 400 }
        );
      }
      
      activeAccountId = activeAccount.sessionId;
      accountData = activeAccount;
      console.log(`✅ Found active account: ${accountData.email} (ID: ${activeAccountId})`);
      
    } else {
      // Validate the provided account
      accountData = await sessionManager.loadSession(linkedinAccountId);
      
      if (!accountData) {
        return NextResponse.json(
          { 
            error: "ACCOUNT_NOT_FOUND",
            message: "LinkedIn account not found" 
          },
          { status: 404 }
        );
      }

      if (accountData.userId !== user.id) {
        return NextResponse.json(
          { 
            error: "ACCOUNT_UNAUTHORIZED",
            message: "LinkedIn account does not belong to user" 
          },
          { status: 403 }
        );
      }

      if (!accountData.isActive) {
        return NextResponse.json(
          { 
            error: "ACCOUNT_INACTIVE",
            message: "LinkedIn account is not active. Please activate it first." 
          },
          { status: 400 }
        );
      }

      console.log(`✅ Account validated: ${accountData.email} (Active: ${accountData.isActive})`);
    }

    // ============================================================
    // STEP 3: Test Session & Keep Browser Open
    // ============================================================
    console.log(`🧪 STEP 3: Testing session validity (keeping browser open)...`);
    
    let browserContext = null;
    let browserPage = null;
    
    try {
      const testResult = await testLinkedInSession(accountData, true);
      
      if (!testResult.isValid) {
        // Mark account as inactive
        await sessionManager.updateSessionStatus(activeAccountId, { 
          isActive: false 
        });
        
        return NextResponse.json(
          { 
            error: "SESSION_INVALID",
            message: "LinkedIn session is invalid or expired. Please reconnect your account.",
            details: testResult.reason
          },
          { status: 401 }
        );
      }

      // Store browser context and page for invite processing
      browserContext = testResult.context;
      browserPage = testResult.page;
      
      console.log(`✅ Session validated: ${testResult.reason}`);
      console.log(`🔓 Browser kept open for direct invite processing`);
      
    } catch (error) {
      console.error(`❌ Session validation failed:`, error);
      return NextResponse.json(
        { 
          error: "SESSION_TEST_FAILED",
          message: "Failed to validate LinkedIn session. Please try again." 
        },
        { status: 500 }
      );
    }

    // ============================================================
    // STEP 4: Fetch Eligible Leads
    // ============================================================
    console.log(`📊 STEP 4: Fetching eligible leads...`);
    
    const { allLeads, eligibleLeads, source } = await fetchEligibleLeads(campaignId);
    
    if (allLeads.length === 0) {
      await cleanupBrowserSession(browserContext);
      return NextResponse.json(
        { 
          error: "NO_LEADS_FOUND",
          message: "No leads found for this campaign. Please add leads first." 
        },
        { status: 400 }
      );
    }

    // Calculate analytics
    const analytics = getLeadAnalytics(allLeads);
    
    console.log(`📊 Lead Analysis:`);
    console.log(`   Total leads: ${analytics.total}`);
    console.log(`   Eligible for invites: ${eligibleLeads.length}`);
    console.log(`   Already sent invites: ${analytics.leadsWithInvites}`);
    console.log(`   Invite status breakdown: ${JSON.stringify(analytics.inviteStats)}`);
    console.log(`   Source: ${source}`);

    if (eligibleLeads.length === 0) {
      await cleanupBrowserSession(browserContext);
      return NextResponse.json(
        { 
          error: "NO_ELIGIBLE_LEADS",
          message: "No eligible leads found for invite sending. All leads either have invites sent or are not completed.",
          data: {
            campaignId,
            totalLeads: analytics.total,
            eligibleLeads: 0,
            leadsWithInvites: analytics.leadsWithInvites,
            inviteStats: analytics.inviteStats
          }
        },
        { status: 400 }
      );
    }

    // ============================================================
    // STEP 5: Process Invites Directly
    // ============================================================
    let inviteResults = null;
    
    try {
      inviteResults = await processInvitesDirectly(
        browserContext,
        browserPage,
        eligibleLeads,
        customMessage,
        campaignId
      );
    } catch (error) {
      console.error(`❌ Failed to process invites:`, error);
      
      // Close browser before returning error
      await cleanupBrowserSession(browserContext);
      
      return NextResponse.json(
        {
          error: "INVITE_PROCESSING_FAILED",
          message: "Failed to process invites. Please try again.",
          details: error.message
        },
        { status: 500 }
      );
    }

    // ============================================================
    // STEP 6: Cleanup Browser
    // ============================================================
    console.log(`🔒 STEP 6: Closing browser...`);
    await cleanupBrowserSession(browserContext);

    // ============================================================
    // Return Success Response
    // ============================================================
    return NextResponse.json({
      success: true,
      message: "Campaign activated and invites processed successfully",
      data: {
        campaign: {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status
        },
        account: {
          id: activeAccountId,
          email: accountData.email,
          name: accountData.userName,
          isActive: accountData.isActive
        },
        leads: {
          total: analytics.total,
          eligible: eligibleLeads.length,
          alreadySent: analytics.leadsWithInvites,
          inviteStats: analytics.inviteStats
        },
        inviteResults: {
          total: inviteResults.total,
          sent: inviteResults.sent,
          alreadyConnected: inviteResults.alreadyConnected,
          alreadyPending: inviteResults.alreadyPending,
          failed: inviteResults.failed,
          errors: inviteResults.errors
        },
        activation: {
          activatedAt: new Date().toISOString(),
          customMessage,
          workflow: "direct-processing"
        }
      }
    });

  } catch (error) {
    console.error("❌ Campaign Activation Error:", error);
    return NextResponse.json(
      { 
        error: "ACTIVATION_ERROR",
        message: "An error occurred during campaign activation",
        details: error.message
      },
      { status: 500 }
    );
  }
});
