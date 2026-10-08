// Results (step 8): how a campaign performed, per platform. computeResults is pure (unit-tested);
// loadCampaignResults reads what it needs from the database. Relative imports only.
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { campaigns, conversationMessages, leads, meetings, messages } from "../schema";
import { DEFAULTS } from "./agent/policy";
import { PLATFORM_KIND } from "./stages";
import { CONVERSATION_STATUS } from "./conversation/status";

const DAY_MS = 24 * 3600 * 1000;
const BOOKED = ["confirmed", "completed"];

const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

/** Funnel stages per kind of platform: label and the test a lead must pass. */
function funnelStages(kind, { minFitScore }) {
  const replied = (l, f) => f.replied.has(l.id);
  const booked = (l, f) => f.booked.has(l.id);
  if (kind === "person") {
    return [
      { key: "added", label: "Added", match: () => true },
      { key: "profile", label: "Profile read", match: (l) => l.status === "completed" },
      { key: "invited", label: "Invite sent", match: (l) => l.inviteSent },
      { key: "connected", label: "Connected", match: (l) => l.inviteStatus === "accepted" },
      { key: "contacted", label: "Messaged", match: (l) => l.messageSent },
      { key: "replied", label: "Replied", match: replied },
      { key: "meeting", label: "Meeting booked", match: booked },
    ];
  }
  return [
    { key: "found", label: "Found", match: () => true },
    { key: "researched", label: "Researched", match: (l) => Boolean(l.sourceData?.research) },
    { key: "fit", label: "Good fit", match: (l) => Number(l.sourceData?.fit?.score) >= minFitScore },
    { key: "written", label: "Email written", match: (l, f) => f.written.has(l.id) },
    { key: "contacted", label: "Contacted", match: (l) => l.messageSent },
    { key: "replied", label: "Replied", match: replied },
    { key: "meeting", label: "Meeting booked", match: booked },
  ];
}

/**
 * @param {object} input
 *   leads: lead rows; written: Set of lead ids with a message; thread: conversation_messages rows;
 *   meetings: meeting rows; now: Date; days: length of the activity chart; minFitScore
 * @returns per-platform results and a platform comparison
 */
export function computeResults({ leads: rows, written = new Set(), thread = [], meetings: meetingRows = [], now = new Date(), days = 14, minFitScore = DEFAULTS.minFitScore }) {
  const replied = new Set(thread.filter((m) => m.direction === "in").map((m) => m.leadId));
  const booked = new Set(meetingRows.filter((m) => BOOKED.includes(m.status)).map((m) => m.leadId));
  const facts = { replied, booked, written };
  const platforms = [...new Set(rows.map((l) => l.source || "linkedin"))];

  const byPlatform = {};
  for (const platform of platforms) {
    const kind = PLATFORM_KIND[platform] || "person";
    const pl = rows.filter((l) => (l.source || "linkedin") === platform);
    const ids = new Set(pl.map((l) => l.id));
    const msgs = thread.filter((m) => ids.has(m.leadId));

    // Funnel: each stage as a share of the first, and of the stage before it
    const stages = funnelStages(kind, { minFitScore });
    const funnel = stages.map((s) => ({ key: s.key, label: s.label, count: pl.filter((l) => s.match(l, facts)).length }));
    funnel.forEach((s, i) => {
      s.ofTotal = pct(s.count, funnel[0].count);
      s.ofPrevious = i === 0 ? 100 : pct(s.count, funnel[i - 1].count);
    });

    const contacted = pl.filter((l) => l.messageSent);
    const repliedHere = contacted.filter((l) => replied.has(l.id)).length;
    const meetingsHere = pl.filter((l) => booked.has(l.id)).length;

    // Time to first reply: from our first email to their first message
    const hoursToReply = [];
    for (const id of ids) {
      const firstOut = msgs.filter((m) => m.leadId === id && m.direction === "out" && m.status === "sent").map((m) => new Date(m.sentAt)).sort((a, b) => a - b)[0];
      const firstIn = msgs.filter((m) => m.leadId === id && m.direction === "in").map((m) => new Date(m.receivedAt || m.createdAt)).sort((a, b) => a - b)[0];
      if (firstOut && firstIn && firstIn > firstOut) hoursToReply.push((firstIn - firstOut) / 3600000);
    }

    // Activity per day: emails we sent and replies we got
    const start = new Date(now.getTime() - (days - 1) * DAY_MS);
    const series = Array.from({ length: days }, (_, i) => ({ day: dayKey(new Date(start.getTime() + i * DAY_MS)), sent: 0, replies: 0 }));
    const index = new Map(series.map((s, i) => [s.day, i]));
    for (const m of msgs) {
      if (m.direction === "out" && m.status === "sent" && m.sentAt && index.has(dayKey(m.sentAt))) series[index.get(dayKey(m.sentAt))].sent++;
      if (m.direction === "in" && index.has(dayKey(m.receivedAt || m.createdAt))) series[index.get(dayKey(m.receivedAt || m.createdAt))].replies++;
    }

    const intents = {};
    for (const m of msgs) if (m.direction === "in" && m.intent) intents[m.intent] = (intents[m.intent] || 0) + 1;

    const outcomes = {};
    for (const l of contacted) {
      const s = booked.has(l.id) ? CONVERSATION_STATUS.MEETING_BOOKED : l.conversationStatus || CONVERSATION_STATUS.AWAITING_REPLY;
      outcomes[s] = (outcomes[s] || 0) + 1;
    }

    const scored = pl.map((l) => Number(l.sourceData?.fit?.score)).filter(Number.isFinite);
    const fit = {
      scored: scored.length,
      average: scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null,
      buckets: [
        { label: "Strong (70+)", count: scored.filter((s) => s >= 70).length, tone: "strong" },
        { label: `Possible (${minFitScore}-69)`, count: scored.filter((s) => s >= minFitScore && s < 70).length, tone: "possible" },
        { label: `Poor (under ${minFitScore})`, count: scored.filter((s) => s < minFitScore).length, tone: "poor" },
      ],
    };

    byPlatform[platform] = {
      kind,
      kpis: {
        leads: pl.length,
        contacted: contacted.length,
        contactRate: pct(contacted.length, pl.length),
        replied: repliedHere,
        replyRate: pct(repliedHere, contacted.length),
        meetings: meetingsHere,
        meetingRate: pct(meetingsHere, contacted.length),
        followUps: msgs.filter((m) => m.kind === "follow_up" && m.status === "sent").length,
        medianHoursToReply: median(hoursToReply),
      },
      funnel,
      series,
      intents,
      outcomes,
      fit,
    };
  }

  const comparison = platforms.map((p) => ({ platform: p, ...byPlatform[p].kpis }));
  return { platforms: byPlatform, comparison };
}

/** Everything computeResults needs for one campaign. */
export async function loadCampaignResults(campaignId, { database = db, now = new Date() } = {}) {
  const [campaign] = await database.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  const rows = await database.select().from(leads).where(eq(leads.campaignId, campaignId));
  const ids = rows.map((l) => l.id);
  const [msgRows, thread, meetingRows] = ids.length
    ? await Promise.all([
        database.select({ leadId: messages.leadId, content: messages.content }).from(messages).where(inArray(messages.leadId, ids)),
        database.select({
          leadId: conversationMessages.leadId, direction: conversationMessages.direction, kind: conversationMessages.kind, status: conversationMessages.status,
          intent: conversationMessages.intent, sentAt: conversationMessages.sentAt, receivedAt: conversationMessages.receivedAt, createdAt: conversationMessages.createdAt,
        }).from(conversationMessages).where(inArray(conversationMessages.leadId, ids)),
        database.select({ leadId: meetings.leadId, status: meetings.status, startAt: meetings.startAt }).from(meetings).where(inArray(meetings.leadId, ids)),
      ])
    : [[], [], []];
  const written = new Set(msgRows.filter((m) => m.content).map((m) => m.leadId));
  return {
    campaign: campaign ? { id: campaign.id, name: campaign.name, createdAt: campaign.createdAt } : null,
    ...computeResults({ leads: rows, written, thread, meetings: meetingRows, now }),
  };
}
