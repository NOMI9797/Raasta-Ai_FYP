import { test } from "node:test";
import assert from "node:assert/strict";
import { STUCK_QUEUED_MS, describeRun, getRunActivity, stageCounts } from "../../libs/agent/run-summary";

const NOW = Date.parse("2026-10-05T12:00:00.000Z");
const run = (over = {}) => ({ id: "r1", jobId: "j1", status: "waiting", currentStep: null, createdAt: new Date(NOW - 5000).toISOString(), errorMessage: null, ...over });
const none = stageCounts({});
const describe = (over = {}, extra = {}) => describeRun({ run: run(over), pending: 0, counts: none, now: NOW, ...extra });

test("stage counts fold statuses into the stages a recruiter thinks in", () => {
  const c = stageCounts({ new: 2, screened: 1, shortlisted: 1, interview_invited: 1, interview_expired: 1, interview_in_progress: 1, interview_completed: 2, final_shortlisted: 1, hired: 1, rejected: 3 });
  assert.deepEqual(c, { total: 14, applied: 3, shortlisted: 1, invited: 2, interviewing: 1, interviewed: 2, final: 2 });
  assert.equal(stageCounts(undefined).total, 0);
});

test("a run that just started says it is starting and what comes next", () => {
  const d = describe({ status: "queued" });
  assert.equal(d.headline, "Starting");
  assert.match(d.detail, /writes the job post first/);
  assert.equal(d.stuck, false);
  assert.equal(d.needsYou, 0);
});

test("a queued run the worker never picked up is called out, with a pointer to the setup guide", () => {
  const d = describe({ status: "queued", createdAt: new Date(NOW - STUCK_QUEUED_MS - 1000).toISOString() });
  assert.equal(d.stuck, true);
  assert.equal(d.tone, "warning");
  assert.match(d.headline, /waiting for the hiring worker/);
  assert.match(d.detail, /Setup guide/);
});

test("requests waiting for the person come first, and the post approval is explained", () => {
  const post = describe({ status: "paused_at_checkpoint", currentStep: "approve_post" }, { pending: 1 });
  assert.equal(post.headline, "1 request is waiting for you");
  assert.match(post.detail, /will not publish it until you approve/);
  assert.equal(post.needsYou, 1);
  const several = describe({ status: "waiting" }, { pending: 3, counts: stageCounts({ new: 3 }) });
  assert.equal(several.headline, "3 requests are waiting for you");
  assert.match(several.detail, /Review them in Decisions/);
});

test("with nothing to decide, an idle agent says it is waiting for applicants and offers the apply link", () => {
  const d = describe({ status: "waiting" });
  assert.equal(d.headline, "Waiting for applicants");
  assert.match(d.detail, /Nothing needs your decision yet/);
  assert.equal(d.applyPath, "/apply/j1");
  assert.equal(d.counts.total, 0);
});

test("with applicants, it lists where they are and still says nothing needs the person", () => {
  const d = describe({ status: "waiting" }, { counts: stageCounts({ new: 3, shortlisted: 1, interview_invited: 2 }) });
  assert.equal(d.headline, "Managing 6 applicants");
  assert.equal(d.detail, "3 being screened, 1 shortlisted, 2 invited to interview. Nothing needs your decision right now.");
  assert.equal(describe({ status: "waiting" }, { counts: stageCounts({ new: 1 }) }).headline, "Managing 1 applicant");
});

test("running, paused, failed, completed and stopped each read plainly", () => {
  assert.match(describe({ status: "running" }, { stepLabel: "Screen applications" }).detail, /Now: screen applications\./);
  assert.equal(describe({ status: "paused" }).headline, "Paused");
  const failed = describe({ status: "failed", errorMessage: "LLM request failed" });
  assert.deepEqual([failed.tone, failed.detail], ["error", "LLM request failed"]);
  assert.equal(describe({ status: "completed" }).tone, "success");
  assert.equal(describe({ status: "cancelled" }).headline, "Stopped");
});

test("activity for a list of runs is read from the database in three queries and never throws", async () => {
  const calls = [];
  const rowsFor = (table) => (table === "actions" ? [{ runId: "r1", n: 2 }] : table === "candidates" ? [{ jobId: "j1", status: "new", n: 4 }, { jobId: "j1", status: "shortlisted", n: 1 }] : [{ id: "j1", title: "Backend Engineer" }]);
  const database = {
    select: () => ({
      from: (t) => {
        const name = t?.agentRunId ? "actions" : t?.jobId && t?.status ? "candidates" : "jobs";
        calls.push(name);
        const chain = { where: () => chain, groupBy: () => Promise.resolve(rowsFor(name)), then: (resolve) => resolve(rowsFor(name)) };
        return chain;
      },
    }),
  };
  const result = await getRunActivity([run({ status: "paused_at_checkpoint", currentStep: "approve_post" })], { database, now: NOW });
  assert.equal(result.size, 1);
  assert.equal(result.get("r1").needsYou, 2);
  assert.equal(result.get("r1").jobTitle, "Backend Engineer");
  assert.equal(calls.length, 3);

  const broken = { select: () => { throw new Error("db down"); } };
  const quiet = await getRunActivity([run()], { database: broken });
  assert.equal(quiet.size, 0);
  assert.equal((await getRunActivity([], { database })).size, 0);
});
