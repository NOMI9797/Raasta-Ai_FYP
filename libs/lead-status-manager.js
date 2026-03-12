/**
 * Lead Status Manager Module
 * 
 * Centralized management of lead status updates across PostgreSQL and Redis.
 * Single source of truth for all lead-related database operations.
 */

import getRedisClient from './redis';
import { db } from './db';
import { leads } from './schema';
import { eq } from 'drizzle-orm';

/**
 * Update lead status in Redis FIRST, then PostgreSQL
 * This ensures cache consistency and faster status checks
 * 
 * @param {string} campaignId - Campaign ID
 * @param {string} leadId - Lead ID
 * @param {string} inviteStatus - Invite status (sent, pending, accepted, rejected, failed)
 * @param {boolean} inviteSent - Whether invite was sent
 */
export async function updateLeadStatus(campaignId, leadId, inviteStatus, inviteSent) {
  // STEP 1: Best-effort Redis cache update (non-fatal on failure)
  try {
    const redis = getRedisClient();
    const leadKey = `campaign:${campaignId}:leads`;

    const leadData = await redis.hget(leadKey, leadId);

    if (leadData) {
      const lead = JSON.parse(leadData);
      lead.inviteSent = inviteSent;
      lead.inviteStatus = inviteStatus;
      lead.inviteSentAt = new Date().toISOString();
      await redis.hset(leadKey, leadId, JSON.stringify(lead));
    } else {
      console.log(`⚠️ Lead ${leadId} not found in Redis cache, skipping cache update`);
    }
  } catch (error) {
    console.warn(`⚠️ Redis update failed for lead ${leadId}, continuing with Postgres only:`, error.message);
  }

  // STEP 2: Update PostgreSQL (persistent storage - must not be skipped)
  await db.update(leads)
    .set({
      inviteSent: inviteSent,
      inviteStatus: inviteStatus,
      inviteSentAt: new Date()
    })
    .where(eq(leads.id, leadId));
}


/**
 * Fetch eligible leads for invite sending
 * First tries Redis cache, falls back to PostgreSQL
 * 
 * @param {string} campaignId - Campaign ID
 * @returns {Promise<Object>} - Object containing allLeads and eligibleLeads arrays
 */
export async function fetchEligibleLeads(campaignId) {
  let leadsData = null;
  let redis = null;

  // Try Redis first, but fall back cleanly on any connection error
  try {
    redis = getRedisClient();
    leadsData = await redis.hgetall(`campaign:${campaignId}:leads`);
  } catch (error) {
    console.warn(`⚠️ Redis hgetall failed for campaign ${campaignId}, falling back to PostgreSQL:`, error.message);
    leadsData = null;
  }
  let allLeads = [];
  
  if (!leadsData || Object.keys(leadsData).length === 0) {
    console.log(`⚠️ Redis cache empty, fetching from PostgreSQL...`);
    
    // Fallback: Fetch leads directly from PostgreSQL
    const dbLeads = await db.select().from(leads).where(eq(leads.campaignId, campaignId));
    
    if (!dbLeads || dbLeads.length === 0) {
      return {
        allLeads: [],
        eligibleLeads: [],
        source: 'postgresql'
      };
    }
    
    // Convert database leads to the expected format
    allLeads = dbLeads.map(lead => ({
      id: lead.id,
      name: lead.name,
      url: lead.url,
      status: lead.status,
      inviteSent: lead.inviteSent || false,
      inviteStatus: lead.inviteStatus || 'pending',
      inviteRetryCount: lead.inviteRetryCount || 0,
      hasMessage: lead.hasMessage || false,
      ...lead
    }));
    
    console.log(`✅ Fetched ${allLeads.length} leads from PostgreSQL (Redis fallback)`);
    
    // Optionally populate Redis cache for future requests
    try {
      const leadsDataForRedis = {};
      allLeads.forEach(lead => {
        leadsDataForRedis[lead.id] = JSON.stringify(lead);
      });
      await redis.hset(`campaign:${campaignId}:leads`, leadsDataForRedis);
      console.log(`🔄 Populated Redis cache with ${allLeads.length} leads`);
    } catch (redisError) {
      console.log(`⚠️ Failed to populate Redis cache:`, redisError.message);
    }
    
  } else {
    // Redis cache has data, use it
    allLeads = Object.values(leadsData).map((s) => JSON.parse(s));
    console.log(`✅ Fetched ${allLeads.length} leads from Redis cache`);
  }
  
  // Filter leads that need invites (independent of post scraping)
  // Only check: has URL, invite not sent, status is eligible
  // Note: Name is optional - we only need the LinkedIn URL to send invites
  console.log(`🔍 Filtering ${allLeads.length} leads for eligibility...`);
  
  const eligibleLeads = allLeads.filter((lead) => {
    const hasUrl = !!lead.url;
    const hasName = !!lead.name;
    const notSent = !lead.inviteSent || lead.inviteSent === false;
    const eligibleStatus = lead.inviteStatus === 'pending' || lead.inviteStatus === 'failed' || !lead.inviteStatus;
    
    // Only require URL, not name (name is optional for display purposes)
    const isEligible = hasUrl && notSent && eligibleStatus;
    
    // Debug logging for each lead
    console.log(`🔍 Lead: ${lead.name || lead.id}`);
    console.log(`   - Has URL: ${hasUrl} (${lead.url || 'MISSING'})`);
    console.log(`   - Has Name: ${hasName} (${lead.name || 'MISSING'}) - OPTIONAL`);
    console.log(`   - Not Sent: ${notSent} (inviteSent: ${lead.inviteSent})`);
    console.log(`   - Eligible Status: ${eligibleStatus} (inviteStatus: ${lead.inviteStatus})`);
    console.log(`   - ✅ ELIGIBLE: ${isEligible}`);
    
    return isEligible;
  });

  return {
    allLeads,
    eligibleLeads,
    source: leadsData && Object.keys(leadsData).length > 0 ? 'redis' : 'postgresql'
  };
}

/**
 * Calculate lead analytics (invite status breakdown)
 * 
 * @param {Array} leads - Array of lead objects
 * @returns {Object} - Analytics object with status counts
 */
export function getLeadAnalytics(leads) {
  // Count invite statuses
  const inviteStats = leads.reduce((acc, lead) => {
    const status = lead.inviteStatus || 'pending';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  // Count leads with invites sent
  const leadsWithInvites = leads.filter(lead => lead.inviteSent === true).length;
  
  return {
    total: leads.length,
    inviteStats,
    leadsWithInvites
  };
}


