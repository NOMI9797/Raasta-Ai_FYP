import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { postProcessFit, scoreCandidateFit, skillAppearsIn, scrubName } from "../../libs/hiring/fit-scorer";
import { buildFitUser, stripPersonalFields } from "../../libs/ai/prompts/fit";

const job = JSON.parse(fs.readFileSync("tests/fixtures/jobs/devops-engineer.json", "utf8"));
const bilalText = fs.readFileSync("tests/fixtures/resumes/strong-2-bilal-qureshi.txt", "utf8");
const bilal = {
  name: "Bilal Qureshi",
  parsedData: {
    name: "Bilal Qureshi", email: "bilal.qureshi@example.com", phone: "+92 300 0000002", location: "Karachi",
    skills: ["Docker", "Kubernetes (EKS)", "AWS", "Terraform", "GitHub Actions", "Linux"],
    yearsExperience: 3,
    _resumeText: bilalText,
  },
};

test("synonym-aware whole-term skill matching", () => {
  assert.equal(skillAppearsIn("Kubernetes", "Operates k8s clusters"), true);
  assert.equal(skillAppearsIn("JavaScript", "Built UIs in JS and React"), true);
  assert.equal(skillAppearsIn("PostgreSQL", "postgres 14"), true);
  assert.equal(skillAppearsIn("Node.js", "node services"), true);
  assert.equal(skillAppearsIn("AWS", "Amazon Web Services certified"), true);
  assert.equal(skillAppearsIn("CI/CD", "built CI/CD pipelines"), true);
  assert.equal(skillAppearsIn("Java", "JavaScript developer"), false); // whole term only
  assert.equal(skillAppearsIn("Go", "good at Google Docs"), false);
});

test("score is clamped and rounded; bad verdicts become unknown", () => {
  const high = postProcessFit({ fitScore: 140.6, experienceMatch: { verdict: "excellent" } }, { job, candidate: bilal });
  assert.equal(high.fitScore, 100);
  assert.equal(high.experienceMatch.verdict, "unknown");
  assert.equal(postProcessFit({ fitScore: -3 }, { job, candidate: bilal }).fitScore, 0);
  assert.equal(postProcessFit({ fitScore: "77.4" }, { job, candidate: bilal }).fitScore, 77);
  assert.equal(postProcessFit({}, { job, candidate: bilal }).fitScore, 0);
});

test("matched/missing are recomputed from the resume; hallucinated skills are flagged", () => {
  const result = postProcessFit({
    fitScore: 85,
    skillMatch: { matched: ["Docker", "Ansible", "Kubernetes"], missing: ["AWS"], extra: ["Prometheus", "Photoshop", "Docker"] },
  }, { job, candidate: bilal });
  assert.deepEqual(result.skillMatch.matched, ["Docker", "Kubernetes", "AWS", "CI/CD", "Terraform", "Linux"]);
  assert.deepEqual(result.skillMatch.missing, []);
  assert.deepEqual(result.skillMatch.unverified, ["Ansible"]);
  assert.deepEqual(result.skillMatch.extra, ["Prometheus"]); // not in resume / required ones dropped
});

test("missing skills are reported for a weak resume", () => {
  const designer = { name: "Zara Malik", parsedData: { _resumeText: fs.readFileSync("tests/fixtures/resumes/unrelated-1-zara-malik.txt", "utf8") } };
  const result = postProcessFit({ fitScore: 8, skillMatch: { matched: ["Linux"] } }, { job, candidate: designer });
  assert.deepEqual(result.skillMatch.matched, []);
  assert.deepEqual(result.skillMatch.missing, job.requiredSkills);
  assert.deepEqual(result.skillMatch.unverified, ["Linux"]);
});

test("the candidate's name is scrubbed from rationale, strengths and concerns", () => {
  const result = postProcessFit({
    fitScore: 80,
    rationale: "Bilal Qureshi has strong EKS experience. Bilal also writes Terraform.",
    strengths: ["Qureshi led a migration to EKS"],
    concerns: ["No Kubernetes certification"],
  }, { job, candidate: bilal });
  assert.equal(result.rationale, "The candidate has strong EKS experience. The candidate also writes Terraform.");
  assert.equal(result.strengths[0], "The candidate led a migration to EKS");
  assert.equal(scrubName("Strong fit: Bilal knows AWS", "Bilal"), "Strong fit: the candidate knows AWS");
  assert.doesNotMatch(JSON.stringify(result), /Bilal|Qureshi/);
  assert.equal(scrubName("Alibaba Cloud experience", "Ali"), "Alibaba Cloud experience"); // whole words only
});

test("lists are capped at 5 and non-strings dropped", () => {
  const result = postProcessFit({ fitScore: 50, strengths: ["a", "b", 3, "c", "d", "e", "f"] }, { job, candidate: bilal });
  assert.deepEqual(result.strengths, ["a", "b", "c", "d", "e"]);
});

test("unreadable resume scores 0 without calling the LLM", async () => {
  const candidate = { name: "Scan", parsedData: { parseError: "Could not extract readable text from resume" } };
  const result = await scoreCandidateFit({ job, candidate }, { llm: async () => { throw new Error("must not call"); } });
  assert.equal(result.fitScore, 0);
  assert.deepEqual(result.concerns, ["Resume could not be read"]);
  assert.equal(result.manualReview, true);
});

test("a failed apply-time parse with readable text is still scored", async () => {
  const candidate = { name: "Bilal", parsedData: { parseError: "Failed to parse resume", _resumeText: bilalText } };
  const result = await scoreCandidateFit({ job, candidate }, { llm: async () => ({ fitScore: 88 }) });
  assert.equal(result.fitScore, 88);
});

test("the LLM is retried twice, rate limits are not", async () => {
  let calls = 0;
  const flaky = async () => { calls += 1; if (calls < 3) throw Object.assign(new Error("boom"), { code: "upstream" }); return { fitScore: 70 }; };
  assert.equal((await scoreCandidateFit({ job, candidate: bilal }, { llm: flaky, sleep: async () => {} })).fitScore, 70);
  assert.equal(calls, 3);

  calls = 0;
  const alwaysDown = async () => { calls += 1; throw Object.assign(new Error("down"), { code: "upstream" }); };
  await assert.rejects(scoreCandidateFit({ job, candidate: bilal }, { llm: alwaysDown, sleep: async () => {} }), /down/);
  assert.equal(calls, 3);

  calls = 0;
  const limited = async () => { calls += 1; throw Object.assign(new Error("429"), { code: "rate_limit" }); };
  await assert.rejects(scoreCandidateFit({ job, candidate: bilal }, { llm: limited, sleep: async () => {} }), { code: "rate_limit" });
  assert.equal(calls, 1);
});

test("the prompt carries no personal identifiers from the parsed resume", () => {
  const stripped = stripPersonalFields(bilal.parsedData);
  for (const field of ["name", "email", "phone", "location", "_resumeText"]) assert.equal(field in stripped, false);
  const user = buildFitUser({ job, candidate: bilal });
  assert.match(user, /Required skills: Docker, Kubernetes, AWS, CI\/CD, Terraform, Linux/);
  assert.doesNotMatch(user.split("CANDIDATE (resume text")[0], /bilal\.qureshi@example\.com|\+92 300/);
});
