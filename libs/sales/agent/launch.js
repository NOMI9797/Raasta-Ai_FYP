// Starting a sales agent run (API route), with a validated config snapshot. Pause, resume and stop
// are the shared ones in libs/agent/launch.js. Relative imports only.
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { agentRuns, campaigns } from "../../schema";
import { RunError } from "../../agent/launch";
import { RUN_STATUS, findActiveSalesRun } from "../../agent/runs";
import { requestAgentTick } from "../../agent/triggers";
import { DEFAULTS, SALES_PIPELINE, normaliseMode } from "./policy";
import { SALES_STEPS } from "./sales-agent";

const intIn = (value, min, max, name) => {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new RunError(`${name} must be a whole number from ${min} to ${max}`, { code: "invalid_config" });
  return n;
};
const text = (value, max = 120) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined);

/** Keep only the settings a sales run uses, checked and with sensible limits. */
export function sanitiseSalesConfig(config = {}) {
  const search = config.search && typeof config.search === "object"
    ? {
        query: text(config.search.query),
        location: text(config.search.location),
        country: text(config.search.country, 20),
        hoursOld: intIn(config.search.hoursOld, 1, 24 * 60, "Posted within (hours)"),
        limit: intIn(config.search.limit, 1, 100, "Search results"),
      }
    : null;
  const out = {
    campaignId: text(config.campaignId, 64),
    accountId: text(config.accountId, 64),
    dailyEmailCap: intIn(config.dailyEmailCap, 1, 200, "Daily email limit"),
    dailyInviteCap: intIn(config.dailyInviteCap, 1, 50, "Daily invite limit"),
    minFitScore: intIn(config.minFitScore, 0, 100, "Minimum fit score"),
    repeatSearch: config.repeatSearch === true,
    search: search && (search.query || search.location) ? Object.fromEntries(Object.entries(search).filter(([, v]) => v !== undefined)) : undefined,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined && v !== false));
}

/** Create a sales run for a campaign the user owns and queue its first tick. */
export async function startSalesRun({ user, agentConfigId = null, mode, config }, { database = db } = {}) {
  const snapshot = sanitiseSalesConfig(config);
  if (!snapshot.campaignId) throw new RunError("Pick a campaign for the sales agent", { code: "campaign_required" });

  const isAdmin = user.role === "admin";
  const [campaign] = await database.select({ id: campaigns.id, userId: campaigns.userId, sources: campaigns.sources }).from(campaigns)
    .where(isAdmin ? eq(campaigns.id, snapshot.campaignId) : and(eq(campaigns.id, snapshot.campaignId), eq(campaigns.userId, user.id)))
    .limit(1);
  if (!campaign) throw new RunError("Campaign not found", { status: 404, code: "campaign_not_found" });
  if (snapshot.search && !(campaign.sources || []).includes("indeed")) {
    throw new RunError("This campaign doesn't take Indeed leads: add Indeed to its platforms or remove the search", { code: "indeed_not_allowed" });
  }
  if (await findActiveSalesRun(campaign.id, { database })) {
    throw new RunError("An agent is already working on this campaign. Stop it before starting another.", { status: 409, code: "already_running" });
  }

  const [run] = await database.insert(agentRuns).values({
    agentConfigId,
    userId: campaign.userId,
    pipelineType: SALES_PIPELINE,
    campaignId: campaign.id,
    mode: normaliseMode(mode),
    status: RUN_STATUS.QUEUED,
    totalSteps: SALES_STEPS.length,
    config: snapshot,
  }).returning();

  await requestAgentTick(run.id, { delayMs: 0 });
  return run;
}

export { DEFAULTS as SALES_DEFAULTS };
