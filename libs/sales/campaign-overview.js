// Campaigns (step 1): the numbers on each campaign card. summariseCampaigns is pure (unit-tested);
// loadCampaignOverview reads what it needs for one user. Relative imports only.
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { agentRuns, campaigns, leads, meetings } from "../schema";
import { ACTIVE_RUN_STATUSES, SALES_PIPELINE } from "../agent/runs";

const BOOKED = ["confirmed", "completed"];
const REPLIED = ["replied", "in_conversation", "meeting_proposed", "meeting_booked", "not_interested", "unsubscribed"];

/**
 * @param leads    [{ campaignId, source, messageSent, conversationStatus }]
 * @param meetings [{ campaignId, leadId, status }]
 * @param runs     sales agent runs, newest first: [{ campaignId, status, mode }]
 * @returns {Record<campaignId, { leads, byPlatform, contacted, replied, meetings, agent }>}
 */
export function summariseCampaigns({ leads: rows = [], meetings: meetingRows = [], runs = [] }) {
  const out = {};
  const entry = (id) => (out[id] ||= { leads: 0, byPlatform: {}, contacted: 0, replied: 0, meetings: 0, agent: null });
  for (const l of rows) {
    const e = entry(l.campaignId);
    e.leads++;
    const source = l.source || "linkedin";
    e.byPlatform[source] = (e.byPlatform[source] || 0) + 1;
    if (l.messageSent) e.contacted++;
    if (REPLIED.includes(l.conversationStatus)) e.replied++;
  }
  const bookedLeads = new Set();
  for (const m of meetingRows) {
    if (!BOOKED.includes(m.status) || bookedLeads.has(m.leadId)) continue;
    bookedLeads.add(m.leadId);
    entry(m.campaignId).meetings++;
  }
  // The newest active run is the campaign's agent
  for (const r of runs) {
    const e = entry(r.campaignId);
    if (!e.agent && ACTIVE_RUN_STATUSES.includes(r.status)) e.agent = { status: r.status, mode: r.mode };
  }
  return out;
}

export async function loadCampaignOverview({ userId, isAdmin = false }, { database = db } = {}) {
  const owned = await database.select({ id: campaigns.id }).from(campaigns).where(isAdmin ? undefined : eq(campaigns.userId, userId));
  const ids = owned.map((c) => c.id);
  if (!ids.length) return {};
  const [leadRows, meetingRows, runs] = await Promise.all([
    database.select({ campaignId: leads.campaignId, source: leads.source, messageSent: leads.messageSent, conversationStatus: leads.conversationStatus })
      .from(leads).where(inArray(leads.campaignId, ids)),
    database.select({ campaignId: meetings.campaignId, leadId: meetings.leadId, status: meetings.status }).from(meetings).where(inArray(meetings.campaignId, ids)),
    database.select({ campaignId: agentRuns.campaignId, status: agentRuns.status, mode: agentRuns.mode }).from(agentRuns)
      .where(and(inArray(agentRuns.campaignId, ids), eq(agentRuns.pipelineType, SALES_PIPELINE))).orderBy(desc(agentRuns.createdAt)),
  ]);
  return summariseCampaigns({ leads: leadRows, meetings: meetingRows, runs });
}
