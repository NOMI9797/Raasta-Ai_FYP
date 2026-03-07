import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { campaigns, leads, messages } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";

// GET /api/campaigns/[id]/leads - Get leads for a campaign (authenticated user)
export const GET = withAuth(async (request, { params, user }) => {
  try {
    const campaignId = params.id;

    // Check if campaign exists and belongs to user
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, user.id)))
      .limit(1);

    if (!campaign) {
      return NextResponse.json(
        { error: "Campaign not found" },
        { status: 404 }
      );
    }

    // Get leads for this campaign (ensure user owns the leads)
    const campaignLeads = await db
      .select({
        id: leads.id,
        name: leads.name,
        url: leads.url,
        title: leads.title,
        company: leads.company,
        campaignId: leads.campaignId,
        inviteSent: leads.inviteSent,
        inviteStatus: leads.inviteStatus,
        inviteSentAt: leads.inviteSentAt,
        createdAt: leads.createdAt
      })
      .from(leads)
      .where(and(eq(leads.campaignId, campaignId), eq(leads.userId, user.id)))
      .orderBy(leads.createdAt);

    return NextResponse.json({
      success: true,
      leads: campaignLeads,
    });
  } catch (error) {
    console.error("Get leads error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
});

// POST /api/campaigns/[id]/leads - Add leads to a campaign (authenticated user)
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const campaignId = params.id;

    // Check if campaign exists and belongs to user
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, user.id)))
      .limit(1);

    if (!campaign) {
      return NextResponse.json({ 
        success: false, 
        message: 'Campaign not found' 
      }, { status: 404 });
    }

    const body = await request.json();
    const { urls, csvData } = body;

    let leadsToInsert = [];

    // Handle URL input
    if (urls && Array.isArray(urls)) {
      const validUrls = urls.filter((url) => 
        url && typeof url === 'string' && url.includes('linkedin.com')
      );

      leadsToInsert = validUrls.map((url) => ({
        userId: user.id,
        campaignId: campaignId,
        url: url.trim(),
        status: 'pending'
      }));
    }

    // Handle CSV data
    if (csvData && Array.isArray(csvData)) {
      const csvLeads = csvData.map((row) => ({
        userId: user.id,
        campaignId: campaignId,
        url: row.url || row.linkedinUrl || row.profile_url,
        name: row.name || row.fullName || row.full_name,
        title: row.title || row.jobTitle || row.job_title,
        company: row.company || row.companyName || row.company_name,
        status: 'pending'
      })).filter((lead) => 
        lead.url && lead.url.includes('linkedin.com')
      );

      leadsToInsert = [...leadsToInsert, ...csvLeads];
    }

    if (leadsToInsert.length === 0) {
      return NextResponse.json({ 
        success: false, 
        message: 'No valid LinkedIn URLs found' 
      }, { status: 400 });
    }

    // Check for existing URLs across ALL campaigns for this user to prevent duplicates
    const existingLeadsAcrossAllCampaigns = await db
      .select({
        url: leads.url,
        campaignId: leads.campaignId,
        campaignName: campaigns.name
      })
      .from(leads)
      .leftJoin(campaigns, eq(leads.campaignId, campaigns.id))
      .where(eq(leads.userId, user.id));
    
    const existingUrlsMap = new Map();
    existingLeadsAcrossAllCampaigns.forEach(lead => {
      existingUrlsMap.set(lead.url, lead.campaignName || 'Unknown Campaign');
    });
    
    const newLeads = [];
    const skippedLeads = [];
    
    leadsToInsert.forEach(lead => {
      if (existingUrlsMap.has(lead.url)) {
        skippedLeads.push({
          url: lead.url,
          name: lead.name,
          reason: `Already exists in campaign: ${existingUrlsMap.get(lead.url)}`
        });
      } else {
        newLeads.push(lead);
      }
    });

    if (newLeads.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'All URLs already exist in your campaigns',
        skippedLeads: skippedLeads
      }, { status: 400 });
    }

    // Insert new leads
    const insertedLeads = await db
      .insert(leads)
      .values(newLeads)
      .returning();

    // Update campaign status to 'active' when first leads are added
    const updates = {
      updatedAt: new Date(),
    };
    
    // If campaign was in draft and now has leads, make it active
    if (campaign.status === 'draft') {
      updates.status = 'active';
    }

    await db
      .update(campaigns)
      .set(updates)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, user.id)));

    console.log(`✅ LEADS ADDED: Successfully added ${insertedLeads.length} leads to campaign ${campaignId}`);

    // Refresh Redis cache for this campaign after adding leads
    console.log(`🔄 CACHE REFRESH: Triggering cache refresh for campaign ${campaignId} after adding leads`);
    try {
      // Import the refresh cache logic directly to avoid auth issues
      const getRedisClient = require('@/libs/redis').default;
      const redis = getRedisClient();
      
      // Fetch fresh campaign data from DB (user-filtered)
      const [campaign] = await db.select()
        .from(campaigns)
        .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, user.id)))
        .limit(1);
        
      if (!campaign) {
        console.log(`⚠️ CACHE REFRESH: Campaign ${campaignId} not found or not owned by user`);
      } else {
        const campaignLeads = await db.select()
          .from(leads)
          .where(and(eq(leads.campaignId, campaignId), eq(leads.userId, user.id)));
          
        const campaignMessages = await db.select()
          .from(messages)
          .where(and(eq(messages.campaignId, campaignId), eq(messages.userId, user.id)));
        
        // Update campaign data in Redis
        await redis.hset(`campaign:${campaignId}:data`, {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          leadsCount: campaignLeads.length,
          messagesCount: campaignMessages.length,
          lastUpdated: Date.now()
        });
        
        // Update leads in Redis with hasMessage status
        if (campaignLeads.length > 0) {
          const leadsData = {};
          const leadsWithMessages = new Set(campaignMessages.map(msg => msg.leadId));
          
          campaignLeads.forEach(lead => {
            const hasMessage = leadsWithMessages.has(lead.id);
            
            leadsData[lead.id] = JSON.stringify({
              id: lead.id,
              name: lead.name,
              title: lead.title,
              company: lead.company,
              url: lead.url,
              status: lead.status,
              hasMessage: hasMessage,
              inviteSent: lead.inviteSent || false,
              inviteStatus: lead.inviteStatus || 'pending'
            });
          });
          
          await redis.hset(`campaign:${campaignId}:leads`, leadsData);
        }
        
        console.log(`✅ CACHE REFRESH: Successfully refreshed cache for campaign ${campaignId}: ${campaignLeads.length} leads cached`);
      }
    } catch (error) {
      console.log(`❌ CACHE REFRESH: Error refreshing cache for campaign ${campaignId}:`, error.message);
    }

    return NextResponse.json({
      success: true,
      message: `Successfully added ${insertedLeads.length} lead${insertedLeads.length !== 1 ? 's' : ''}${skippedLeads.length > 0 ? `, skipped ${skippedLeads.length} duplicate${skippedLeads.length !== 1 ? 's' : ''}` : ''}`,
      leads: insertedLeads,
      skippedLeads: skippedLeads,
      stats: {
        added: insertedLeads.length,
        skipped: skippedLeads.length,
        total: leadsToInsert.length
      }
    });

  } catch (error) {
    console.error("Add leads error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
});