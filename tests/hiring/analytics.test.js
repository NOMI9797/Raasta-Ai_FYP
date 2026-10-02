import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHiringAnalytics } from "../../libs/hiring/analytics";

const now = new Date("2026-10-03T12:00:00Z");

test("buildHiringAnalytics returns zeros for an empty workspace", () => {
  const a = buildHiringAnalytics({ jobs: [], candidates: [], now });
  assert.equal(a.totals.applied, 0);
  assert.equal(a.totals.avgFitScore, null);
  assert.equal(a.totals.shortlistRate, 0);
  assert.equal(a.timeline.length, 14);
  assert.ok(a.timeline.every((d) => d.applications === 0));
  assert.deepEqual(a.byJob, []);
  assert.ok(a.stages.every((s) => s.count === 0));
});

test("buildHiringAnalytics computes the funnel, sources, timeline and per-job stats", () => {
  const jobs = [
    { id: "j1", title: "React Dev", status: "published" },
    { id: "j2", title: "Designer", status: "draft" },
  ];
  const candidates = [
    { jobId: "j1", status: "new", source: "direct", fitScore: null, appliedAt: "2026-10-03T09:00:00Z" },
    { jobId: "j1", status: "screened", source: "rozee", fitScore: 60, appliedAt: "2026-10-02T09:00:00Z" },
    { jobId: "j1", status: "shortlisted", source: "rozee", fitScore: 80, appliedAt: "2026-10-02T10:00:00Z" },
    { jobId: "j1", status: "hired", source: "linkedin", fitScore: 90, appliedAt: "2026-09-01T10:00:00Z" },
    { jobId: "j2", status: "rejected", source: "direct", fitScore: 30, appliedAt: "2026-10-01T10:00:00Z" },
  ];
  const a = buildHiringAnalytics({ jobs, candidates, now });

  assert.equal(a.totals.jobs, 2);
  assert.equal(a.totals.publishedJobs, 1);
  assert.equal(a.totals.applied, 5);
  assert.equal(a.totals.screened, 4);
  assert.equal(a.totals.shortlisted, 2); // shortlisted + hired
  assert.equal(a.totals.interviewed, 1);
  assert.equal(a.totals.hired, 1);
  assert.equal(a.totals.avgFitScore, 65);
  assert.equal(a.totals.shortlistRate, 50);
  assert.equal(a.totals.hireRate, 20);

  assert.deepEqual(a.sources[0], { source: "direct", count: 2 });
  assert.equal(a.stages.find((s) => s.stage === "applied").count, 2);
  assert.equal(a.stages.find((s) => s.stage === "closed").count, 1);

  // the September application is outside the 14-day window
  assert.equal(a.timeline.reduce((n, d) => n + d.applications, 0), 4);
  assert.equal(a.timeline.at(-1).date, "2026-10-03");
  assert.equal(a.timeline.at(-1).applications, 1);

  const j1 = a.byJob.find((j) => j.jobId === "j1");
  assert.equal(j1.applied, 4);
  assert.equal(j1.avgFitScore, 77);
  assert.equal(a.byJob.find((j) => j.jobId === "j2").shortlisted, 0);
});
