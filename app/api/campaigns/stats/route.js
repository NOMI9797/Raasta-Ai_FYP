/**
 * Campaign Statistics API
 * 
 * GET /api/campaigns/stats
 * GET /api/campaigns/stats?campaignId=xxx
 * 
 * Returns aggregated statistics for LinkedIn invite statuses
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { db } from "@/libs/db";
import { leads, campaigns } from "@/libs/schema";
import { eq, inArray } from "drizzle-orm";

export const GET = withAuth(async (request, { user }) => {
  try {
    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get('campaignId');
    
    console.log(`📊 Fetching stats for user: ${user.id}${campaignId ? `, campaign: ${campaignId}` : ' (all campaigns)'}`);
    
    // Get all campaigns for the user
    const userCampaigns = await db.query.campaigns.findMany({
      where: eq(campaigns.userId, user.id),
      orderBy: (campaigns, { desc }) => [desc(campaigns.createdAt)]
    });
    
    if (userCampaigns.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          global: {
            total: 0,
            pending: 0,
            sent: 0,
            accepted: 0,
            rejected: 0,
            failed: 0,
            acceptanceRate: 0
          },
          byCampaign: [],
          timeline: []
        }
      });
    }
    
    // Fetch all leads with invite data
    const campaignIds = userCampaigns.map(c => c.id);
    const whereCondition = campaignId 
      ? eq(leads.campaignId, campaignId)
      : inArray(leads.campaignId, campaignIds);
    
    const allLeads = await db.query.leads.findMany({
      where: whereCondition,
      columns: {
        id: true,
        name: true,
        url: true,
        campaignId: true,
        inviteSent: true,
        inviteStatus: true,
        inviteSentAt: true,
        createdAt: true
      }
    });
    
    console.log(`📊 Found ${allLeads.length} leads`);
    
    // Calculate global statistics
    const globalStats = calculateStats(allLeads);
    
    // Calculate per-campaign statistics
    const byCampaign = userCampaigns.map(campaign => {
      const campaignLeads = allLeads.filter(lead => lead.campaignId === campaign.id);
      const stats = calculateStats(campaignLeads);
      
      return {
        campaignId: campaign.id,
        campaignName: campaign.name,
        stats
      };
    }).filter(c => c.stats.total > 0); // Only include campaigns with leads
    
    // Calculate timeline data (last 30 days)
    const timeline = calculateTimeline(allLeads);
    
    return NextResponse.json({
      success: true,
      data: {
        global: globalStats,
        byCampaign,
        timeline,
        campaigns: userCampaigns.map(c => ({ id: c.id, name: c.name }))
      }
    });
    
  } catch (error) {
    console.error('❌ Stats API error:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to fetch statistics',
        message: error.message 
      },
      { status: 500 }
    );
  }
});

/**
 * Calculate statistics from leads array
 */
function calculateStats(leads) {
  const total = leads.length;
  
  // Count by invite status
  const pending = leads.filter(l => !l.inviteSent || l.inviteStatus === 'pending').length;
  const sent = leads.filter(l => l.inviteSent && l.inviteStatus === 'sent').length;
  const accepted = leads.filter(l => l.inviteStatus === 'accepted').length;
  const rejected = leads.filter(l => l.inviteStatus === 'rejected').length;
  const failed = leads.filter(l => l.inviteStatus === 'failed').length;
  
  // Calculate acceptance rate (accepted / total invites sent)
  const totalInvitesSent = sent + accepted + rejected + failed;
  const acceptanceRate = totalInvitesSent > 0 
    ? Math.round((accepted / totalInvitesSent) * 100) 
    : 0;
  
  return {
    total,
    pending,
    sent,
    accepted,
    rejected,
    failed,
    acceptanceRate,
    totalInvitesSent
  };
}

/**
 * Calculate timeline data for the last 30 days
 */
function calculateTimeline(leads) {
  const timeline = [];
  const today = new Date();
  
  // Generate last 7 days
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);
    
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);
    
    // Filter leads sent on this day
    const dayLeads = leads.filter(lead => {
      if (!lead.inviteSentAt) return false;
      const sentDate = new Date(lead.inviteSentAt);
      return sentDate >= date && sentDate < nextDate;
    });
    
    timeline.push({
      date: date.toISOString().split('T')[0],
      sent: dayLeads.filter(l => l.inviteStatus === 'sent').length,
      accepted: dayLeads.filter(l => l.inviteStatus === 'accepted').length,
      rejected: dayLeads.filter(l => l.inviteStatus === 'rejected').length,
      failed: dayLeads.filter(l => l.inviteStatus === 'failed').length
    });
  }
  
  return timeline;
}

