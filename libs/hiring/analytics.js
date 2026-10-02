// Hiring analytics: pure aggregation over jobs + candidates rows, so it can be unit-tested
// without a database. Used by GET /api/hiring/analytics.
import { CANDIDATE_STATUS, KANBAN_STAGES, STATUS_META } from "./statuses";
import { POST_SHORTLIST_STATUSES } from "./shortlist";

const INTERVIEWED = [
  CANDIDATE_STATUS.INTERVIEW_COMPLETED,
  CANDIDATE_STATUS.FINAL_SHORTLISTED,
  CANDIDATE_STATUS.FINAL_REJECTED,
  CANDIDATE_STATUS.HIRED,
];
const FINAL = [CANDIDATE_STATUS.FINAL_SHORTLISTED, CANDIDATE_STATUS.HIRED];

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const average = (values) =>
  values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;

function funnelOf(rows) {
  const applied = rows.length;
  const screened = rows.filter((c) => c.fitScore != null).length;
  const shortlisted = rows.filter((c) => POST_SHORTLIST_STATUSES.includes(c.status)).length;
  const interviewed = rows.filter((c) => INTERVIEWED.includes(c.status)).length;
  const final = rows.filter((c) => FINAL.includes(c.status)).length;
  const hired = rows.filter((c) => c.status === CANDIDATE_STATUS.HIRED).length;
  return { applied, screened, shortlisted, interviewed, final, hired };
}

function dayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

/**
 * @param {{ jobs: Array<{id, title, status}>, candidates: Array<{jobId, status, source, fitScore, appliedAt}>, days?: number, now?: Date }} input
 */
export function buildHiringAnalytics({ jobs, candidates, days = 14, now = new Date() }) {
  const funnel = funnelOf(candidates);
  const fitScores = candidates.map((c) => c.fitScore).filter((s) => s != null);

  const stages = KANBAN_STAGES.map(({ value, label }) => ({
    stage: value,
    label,
    count: candidates.filter((c) => (STATUS_META[c.status]?.stage || "applied") === value).length,
  }));

  const sourceCounts = new Map();
  for (const c of candidates) {
    const source = c.source || "direct";
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
  }
  const sources = [...sourceCounts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);

  // Applications per day for the last `days` days (UTC), oldest first, zero-filled
  const perDay = new Map();
  for (const c of candidates) {
    const key = dayKey(c.appliedAt);
    perDay.set(key, (perDay.get(key) || 0) + 1);
  }
  const timeline = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const key = dayKey(d);
    timeline.push({ date: key, applications: perDay.get(key) || 0 });
  }

  const byJob = jobs.map((job) => {
    const rows = candidates.filter((c) => c.jobId === job.id);
    const scores = rows.map((c) => c.fitScore).filter((s) => s != null);
    return {
      jobId: job.id,
      title: job.title,
      status: job.status,
      ...funnelOf(rows),
      avgFitScore: average(scores),
    };
  });

  return {
    totals: {
      jobs: jobs.length,
      publishedJobs: jobs.filter((j) => j.status === "published").length,
      ...funnel,
      avgFitScore: average(fitScores),
      shortlistRate: pct(funnel.shortlisted, funnel.screened),
      interviewRate: pct(funnel.interviewed, funnel.shortlisted),
      hireRate: pct(funnel.hired, funnel.applied),
    },
    stages,
    sources,
    timeline,
    byJob,
  };
}
