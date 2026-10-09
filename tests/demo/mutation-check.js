// "Can these test cases actually fail?" (docs/ai-hiring/22-demo-test-cases.md, section 4)
//
//   npm run demo:mutations
//
// A passing test proves nothing unless it would fail when the code is wrong. This script breaks the
// production code on purpose, one small change at a time (a "mutation": for example >= becomes >),
// and checks that the demo cases notice. It works on a throw-away COPY of the code in the system temp
// folder; the repository itself is never edited. A mutation that no case notices is a "survivor":
// a hole in the tests.
import "../../libs/load-env"; // the copies inherit DATABASE_URL etc. from this process; nothing is written to disk
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

const ROOT = process.cwd();
const COPY = ["libs", "config.js", "jsconfig.json", "package.json", "tests/demo", "tests/fixtures", "tests/hiring/helpers", "app/api/hiring/apply"];

// stage: the demo stage that should notice. expect: at least one of these cases should fail.
const MUTATIONS = [
  { id: "M01", stage: 1, file: "libs/hiring/resume-text.js", find: "if (size > MAX_RESUME_BYTES)", replace: "if (size > MAX_RESUME_BYTES * 100)", what: "oversized resumes are accepted", expect: ["S1-01"] },
  { id: "M02", stage: 1, file: "libs/hiring/fit-scorer.js", find: "const unverified = llmMatched.filter(", replace: "const unverified = [].filter(", what: "AI skill claims are no longer checked against the resume", expect: ["S1-09"] },
  { id: "M03", stage: 1, file: "libs/hiring/fit-scorer.js", find: "const matched = required.filter((skill) => skillAppearsIn(skill, evidence));", replace: "const matched = required.filter((skill) => llmMatched.includes(skill) || skillAppearsIn(skill, evidence));", what: "AI-claimed skills are counted as matched", expect: ["S1-09"] },
  { id: "M04", stage: 1, file: "libs/hiring/fit-scorer.js", find: 'if (typeof text !== "string" || !name) return text;', replace: "return text;", what: "candidate names stop being scrubbed from AI explanations", expect: ["S1-11"] },
  { id: "M05", stage: 1, file: "libs/hiring/fit-scorer.js", find: "Math.min(100, Math.max(0, score))", replace: "Math.min(1000, Math.max(0, score))", what: "scores above 100 are stored", expect: ["S1-10"] },
  { id: "M06", stage: 1, file: "libs/hiring/fit-scorer.js", find: 'if (error?.code === "rate_limit" || attempt === LLM_ATTEMPTS) break;', replace: "if (attempt === LLM_ATTEMPTS) break;", what: "rate limits are retried immediately", expect: ["S1-14"] },
  { id: "M07", stage: 2, file: "libs/hiring/shortlist.js", find: "candidate.fitScore >= minFitScore", replace: "candidate.fitScore > minFitScore", what: "a score exactly at the threshold no longer qualifies", expect: ["S2-02"] },
  { id: "M08", stage: 2, file: "libs/hiring/shortlist.js", find: "count < maxShortlist", replace: "count <= maxShortlist", what: "the shortlist cap lets one extra person through", expect: ["S2-01", "S2-03"] },
  { id: "M09", stage: 2, file: "libs/hiring/shortlist.js", find: "new Date(a.appliedAt) - new Date(b.appliedAt)", replace: "new Date(b.appliedAt) - new Date(a.appliedAt)", what: "ties go to the LATEST applicant", expect: ["S2-04"] },
  { id: "M10", stage: 2, file: "libs/hiring/statuses.js", find: "hired: [], rejected: ['shortlisted'],", replace: "hired: ['rejected'], rejected: ['shortlisted'],", what: "a hired candidate can be rejected by hand", expect: ["S2-10"] },
  { id: "M11", stage: 2, file: "libs/hiring/config.js", find: "autoFinalize: false,", replace: "autoFinalize: true,", what: "new jobs decide rejections automatically", expect: ["S2-09"] },
  { id: "M12", stage: 2, file: "libs/hiring/config.js", find: '["minFitScore", 0, 100],', replace: '["minFitScore", 0, 1000],', what: "a threshold of 150 is accepted", expect: ["S2-08"] },
  { id: "M13", stage: 3, file: "libs/interview/tokens.js", find: 'crypto.createHash("sha256")', replace: 'crypto.createHash("md5")', what: "links are hashed with MD5 instead of SHA-256", expect: ["S3-02"] },
  { id: "M14", stage: 3, file: "libs/interview/tokens.js", find: "if (payload.typ !== TICKET_TYPE || !payload.sub || !payload.cid) {", replace: "if (!payload.sub || !payload.cid) {", what: "tickets of any type are accepted", expect: ["S3-08"] },
  { id: "M15", stage: 3, file: "libs/interview/tokens.js", find: "export const TICKET_TTL_SECONDS = 10 * 60;", replace: "export const TICKET_TTL_SECONDS = 24 * 60 * 60;", what: "interview tickets live a day instead of ten minutes", expect: ["S3-05"] },
  { id: "M16", stage: 3, file: "libs/interview/public-access.js", find: "const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,100}$/;", replace: "const TOKEN_PATTERN = /^.*$/;", what: "any text is accepted as an interview link", expect: ["S3-03"] },
  { id: "M17", stage: 3, file: "libs/hiring/emails.js", find: "`Good news: you've moved to the next round for ${jobTitle}.`", replace: "`Good news: you've moved to the next round for ${jobTitle}. Your score was 92%.`", what: "the outcome e-mail tells the candidate their score", expect: ["S3-14"] },
  { id: "M18", stage: 4, file: "libs/interview/session-engine.js", find: "snap.depth < this.config.maxFollowUps", replace: "snap.depth <= this.config.maxFollowUps", what: "three follow-ups are asked instead of two", expect: ["S4-06"] },
  { id: "M19", stage: 4, file: "libs/interview/session-engine.js", find: 'this.deps.send("question", { index: this.state.questionIndex, total: this.state.totalQuestions, text: questionText || text, kind });', replace: 'this.deps.send("question", { index: this.state.questionIndex, total: this.state.totalQuestions, text: questionText || text, kind, score: 100 });', what: "a score is sent to the candidate's screen", expect: ["S4-16"] },
  { id: "M20", stage: 5, file: "libs/hiring/final-evaluator.js", find: "return score >= threshold ? CANDIDATE_STATUS.FINAL_SHORTLISTED", replace: "return score > threshold ? CANDIDATE_STATUS.FINAL_SHORTLISTED", what: "a final score exactly at the threshold is rejected", expect: ["S5-09"] },
  { id: "M21", stage: 5, file: "libs/hiring/final-evaluator.js", find: "(totalAnswers ?? 0) < totalQuestions * 0.5", replace: "(totalAnswers ?? 0) < totalQuestions * 0.1", what: "an interview with 1 of 3 answers is trusted", expect: ["S5-10"] },
  { id: "M22", stage: 5, file: "libs/hiring/final-evaluator.js", find: "pace: 0.3, fluency: 0.3, eyeContact: 0.25, composure: 0.15", replace: "pace: 0.5, fluency: 0.3, eyeContact: 0.25, composure: 0.15", what: "pace counts for more than the specification says", expect: ["S5-04", "S5-05"] },
  { id: "M23", stage: 5, file: "libs/hiring/final-evaluator.js", find: "isNum(parts[k]) && weights[k] > 0", replace: "weights[k] > 0", what: "a missing measurement counts as zero instead of being left out", expect: ["S5-05", "S5-08"] },
  { id: "M24", stage: 5, file: "libs/interview/repository.js", find: "const weight = weightOf.get(questionId) || 1;", replace: "const weight = 1;", what: "every question weighs the same in the interview score", expect: ["S5-06"] },
  // sendInvite has two independent guards against a second invite; removing either one alone changes nothing a
  // caller can see (an "equivalent" mutation), so both are removed together
  { id: "M25", stage: 6, db: true, file: "libs/hiring/invitations.js", what: "a repeated send-invite is no longer skipped (both safeguards removed)", expect: ["S6-10"], edits: [
    { find: "if (current && !resend) {", replace: "if (false) {" },
    { find: 'if (!resend && candidate.status === CANDIDATE_STATUS.INTERVIEW_INVITED) return { skipped: "already invited" };', replace: "" },
  ] },
  { id: "M26", stage: 6, db: true, file: "libs/hiring/invitations.js", find: ": [CANDIDATE_STATUS.SHORTLISTED, CANDIDATE_STATUS.INTERVIEW_EXPIRED];", replace: ": [CANDIDATE_STATUS.SHORTLISTED, CANDIDATE_STATUS.INTERVIEW_EXPIRED, CANDIDATE_STATUS.NOT_SHORTLISTED];", what: "rejected candidates can be invited", expect: ["S6-11"] },
  { id: "M27", stage: 6, db: true, file: "libs/interview/public-access.js", find: "if (new Date(interview.expiresAt).getTime() <= now.getTime()) {", replace: "if (false) {", what: "expired interview links keep working", expect: ["S6-13"] },
  { id: "M28", stage: 6, db: true, file: "libs/hiring/finalize.js", find: "if (config.autoFinalize && suggestedDecision !== NEEDS_REVIEW", replace: "if (suggestedDecision !== NEEDS_REVIEW", what: "the system decides even when the recruiter turned automation off", expect: ["S6-17"] },
  { id: "M29", stage: 6, db: true, file: "libs/hiring/finalize.js", find: "&& !(await d.isManaged(job.id))", replace: "", what: "the system overrides jobs the agent manages", expect: ["S6-19"] },
  { id: "M30", stage: 6, db: true, file: "libs/hiring/decisions.js", find: "if (candidate.status !== decision && !canTransition(candidate.status, decision)) {", replace: "if (false) {", what: "illegal status moves are allowed", expect: ["S6-18"] },
  { id: "M31", stage: 6, db: true, file: "app/api/hiring/apply/[jobId]/route.js", find: "if (fileError) {", replace: "if (false) {", what: "the apply form accepts any file type", expect: ["S6-04"] },
];

function copyInto(dir) {
  for (const item of COPY) {
    const from = path.join(ROOT, item);
    const to = path.join(dir, item);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true });
  }
  // The copy shares the real node_modules through a junction (removed again before the folder is deleted)
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"), "junction");
}

function runDemo(dir, args) {
  const out = path.join(dir, `result-${Date.now()}.json`);
  const cli = path.join(dir, "node_modules", "tsx", "dist", "cli.mjs");
  const run = spawnSync(process.execPath, [cli, "--tsconfig", "jsconfig.json", "tests/demo/run.js", "--brief", "--json", out, ...args], {
    cwd: dir, env: { ...process.env, FORCE_COLOR: "" }, encoding: "utf8", timeout: 240000,
  });
  if (!fs.existsSync(out)) return { crashed: true, detail: `${run.stderr || run.stdout}`.split("\n").slice(-6).join("\n"), cases: [] };
  const report = JSON.parse(fs.readFileSync(out, "utf8"));
  return { crashed: false, cases: report.cases, totals: report.totals };
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "raasta-mutation-"));
  const failedIds = (r) => r.cases.filter((c) => c.status === "fail").map((c) => c.id);
  const survivors = [];
  const problems = [];
  const databaseUp = { value: null };
  try {
    console.log(`Working copy: ${tmp} (the repository is not touched)\n`);
    copyInto(tmp);

    console.log("Step 1: the unmodified copy must pass every case, otherwise the check means nothing.");
    const clean = runDemo(tmp, ["--stage", "1,2,3,4,5,6"]);
    if (clean.crashed) throw new Error(`the unmodified copy did not run:\n${clean.detail}`);
    if (failedIds(clean).length) throw new Error(`the unmodified copy already fails: ${failedIds(clean).join(", ")}`);
    const stage6 = clean.cases.filter((c) => c.stage === 6);
    databaseUp.value = stage6.length > 0 && stage6.every((c) => c.status === "pass");
    console.log(`  ${clean.totals.pass} of ${clean.totals.total} passed${databaseUp.value ? "" : " (stage 6 skipped: database not available, so mutations M25-M31 cannot be checked)"}\n`);

    console.log("Step 2: break the code one small change at a time and see which case notices.\n");
    console.log("  id    caught by           what was broken");
    for (const m of MUTATIONS) {
      if (m.db && !databaseUp.value) {
        console.log(`  ${m.id}  not checked         ${m.what}`);
        continue;
      }
      const target = path.join(tmp, m.file);
      const original = fs.readFileSync(path.join(ROOT, m.file), "utf8");
      const edits = m.edits || [{ find: m.find, replace: m.replace }];
      const badEdit = edits.map((e) => ({ e, hits: original.split(e.find).length - 1 })).find((x) => x.hits !== 1);
      if (badEdit) {
        problems.push(`${m.id}: the text to change was found ${badEdit.hits} times in ${m.file} (the source has moved on; update this list)`);
        console.log(`  ${m.id}  ERROR               ${m.what}`);
        continue;
      }
      fs.writeFileSync(target, edits.reduce((text, e) => text.replace(e.find, () => e.replace), original));
      const result = runDemo(tmp, ["--stage", String(m.stage)]);
      fs.writeFileSync(target, original); // restore the copy before the next mutation
      const failed = result.crashed ? ["(crashed)"] : failedIds(result);
      const noticed = m.expect.filter((id) => failed.includes(id));
      if (!failed.length) {
        survivors.push(m);
        console.log(`  ${m.id}  SURVIVED           ${m.what}`);
      } else {
        console.log(`  ${m.id}  ${failed.slice(0, 3).join(", ").padEnd(19)} ${m.what}${noticed.length ? "" : "   (noticed, but not by the case expected)"}`);
      }
    }
  } finally {
    try { fs.rmdirSync(path.join(tmp, "node_modules")); } catch { /* not created */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const checked = MUTATIONS.filter((m) => !m.db || databaseUp.value);
  console.log(`\n${checked.length - survivors.length - problems.length} of ${checked.length} deliberate bugs were caught, ${survivors.length} survived.`);
  for (const m of survivors) console.log(`  SURVIVOR ${m.id}: ${m.what}`);
  for (const p of problems) console.log(`  PROBLEM ${p}`);
  return survivors.length || problems.length ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
