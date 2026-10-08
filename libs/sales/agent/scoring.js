// The sales agent's judgement: how well a lead fits the campaign (0-100) and why, in one sentence.
// Leads under the campaign's minimum are skipped; scores near it go to a person. Relative imports only.
import { chatJSON, getFastModel } from "../../ai/llm";
import { PLATFORM_KIND } from "../stages";
import { companyNameOf, jobsOf } from "../companies";

function offer(campaign) {
  const icp = campaign?.icpConfig || {};
  return [
    icp.serviceType && `What we sell: ${icp.serviceType}`,
    icp.industry && `Industries we target: ${icp.industry}`,
    icp.targetRole && `Roles we sell to: ${icp.targetRole}`,
    campaign?.description && `Campaign notes: ${campaign.description}`,
  ].filter(Boolean).join("\n") || "What we sell is not specified: judge general B2B potential (growth, size, activity).";
}

/** @returns {{ system: string, user: string }} */
export function scorePrompt({ lead, campaign, posts = [] }) {
  const isCompany = PLATFORM_KIND[lead.source] === "company";
  const research = lead.sourceData?.research || {};
  const known = lead.sourceData?.company || {};
  const about = isCompany
    ? [
        `Company: ${companyNameOf(lead)}`,
        `Open roles: ${jobsOf(lead).map((j) => j.title).filter(Boolean).slice(0, 8).join("; ") || "unknown"}`,
        known.industry && `Industry: ${known.industry}`,
        known.employees && `Size: ${known.employees} staff`,
        research.description && `From their website: ${research.description.slice(0, 400)}`,
        `Contact found: ${research.emails?.length || research.contacts?.length ? "an email address" : research.decisionMakers?.length ? "a decision-maker on LinkedIn" : "none"}`,
      ]
    : [
        `Person: ${lead.name || "unknown"}${lead.title ? `, ${lead.title}` : ""}${lead.company ? ` at ${lead.company}` : ""}`,
        posts.length ? `Recent posts:\n${posts.slice(0, 3).map((p) => `- ${String(p.content || "").slice(0, 300)}`).join("\n")}` : "No recent posts.",
      ];

  return {
    system: [
      "You qualify B2B sales leads. Score how likely this lead is to need what we sell and to reply, from 0 to 100.",
      "80+: clear need and a way to reach them. 50-79: plausible. Under 50: poor fit or no way to reach them.",
      "A company hiring for roles related to what we sell is a strong signal. Use only the facts given.",
      'Return JSON: {"score": number, "reason": "one short sentence a salesperson can read"}',
    ].join("\n"),
    user: [offer(campaign), "", ...about.filter(Boolean)].join("\n"),
  };
}

export function normaliseScore(out) {
  const score = Math.round(Number(out?.score));
  if (!Number.isFinite(score)) throw new Error("The AI did not return a score");
  return { score: Math.max(0, Math.min(100, score)), reason: String(out?.reason || "").slice(0, 300) || null };
}

/** @returns {Promise<{ score: number, reason: string|null, model: string, scoredAt: string }>} */
export async function scoreLead({ lead, campaign, posts }) {
  const model = getFastModel();
  const out = await chatJSON({ ...scorePrompt({ lead, campaign, posts }), model, temperature: 0.2, maxTokens: 800 });
  return { ...normaliseScore(out), model, scoredAt: new Date().toISOString() };
}
