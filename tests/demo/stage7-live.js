// Stage 7: the real language model (Groq) on the same fixtures. Run with: npm run demo:tests -- --live
// A real model gives slightly different numbers every time, so these cases check PROPERTIES that must
// hold for any reasonable answer (order of groups, no strong-versus-unrelated overlap, margins, ranges),
// never an exact score. Sends only the synthetic fixture resumes and questions; no real person's data.
import assert from "node:assert/strict";
import { chatJSON } from "../../libs/ai/llm";
import { buildParsedData } from "../../libs/hiring/resume-text";
import { scoreCandidateFit, skillAppearsIn } from "../../libs/hiring/fit-scorer";
import { decideShortlist } from "../../libs/hiring/shortlist";
import { CATEGORIES, DIFFICULTIES, generateJobQuestions } from "../../libs/interview/question-generator";
import { scoreAnswer } from "../../libs/interview/answer-scorer";
import { EXPECTED_SKILLS, job, readResume, REQUIRED } from "./fixtures";
import { Skip } from "./runner";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const GROUPS = ["strong", "partial", "unrelated"];
const SCAN = "unreadable-scanned.pdf";
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const fmt = (n) => (Math.round(n * 10) / 10).toString();

/** Retry politely when the provider says "slow down", so a demo does not fail on a rate limit. */
async function patiently(fn, tries = 5) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (error?.code !== "rate_limit" || attempt >= tries) throw error;
      await sleep(error.retryAfterMs || 8000 * attempt);
    }
  }
}

// What the cases below pass to the production code instead of the bare model call
const patientLlm = (args) => patiently(() => chatJSON(args));

const stats = { parseRetries: 0 };

/**
 * buildParsedData never throws: when the model is rate-limited it returns a parseError and the resume is
 * still scored from its text. For a fair comparison the demo waits and parses again until it works.
 */
async function parseResume(buffer, filename) {
  // The production code logs "Resume parsing failed: rate_limit" on each miss; the demo counts them instead
  const original = console.error;
  console.error = (...args) => { if (!String(args[0]).startsWith("Resume parsing failed")) original(...args); };
  try {
    for (let attempt = 1; ; attempt += 1) {
      const parsed = await buildParsedData({ buffer, filename });
      if (parsed.parseError !== "Failed to parse resume" || attempt >= 4) return parsed;
      stats.parseRetries += 1;
      await sleep(15000);
    }
  } finally {
    console.error = original;
  }
}

async function scoreFile(file, name) {
  const parsedData = await parseResume(readResume(file), file);
  const candidate = { name, parsedData };
  const result = await patiently(() => scoreCandidateFit({ job, candidate }));
  await sleep(1500); // stay inside the provider's per-minute limit
  return { candidate, result };
}

const groupScores = (ctx, group) => Object.entries(EXPECTED_SKILLS).filter(([, v]) => v.group === group).map(([file]) => ctx.scored[file].result.fitScore);

export default {
  id: 7,
  title: "Live AI check (real language model)",
  tier: "live",
  intro: "The same resumes and answers, judged by the real model. Properties are checked, not exact numbers.",
  async setup() {
    if (!process.env.GROQ_API_KEY) throw new Skip("GROQ_API_KEY is not set");
    return { scored: {} };
  },
  cases: [
    {
      id: "S7-01",
      title: "The real model reads and scores all nine fixture resumes through the production code path",
      requirement: "buildParsedData (model reads the resume) then scoreCandidateFit (model judges fit), exactly as the worker does.",
      input: "8 readable resumes + the scanned PDF, against the DevOps Engineer job",
      expect: "8 integer scores from 0 to 100 and the scanned PDF scored 0 for manual review, without error",
      run: async (ctx) => {
        for (const [file, entry] of Object.entries(EXPECTED_SKILLS)) {
          ctx.scored[file] = await scoreFile(file, entry.name);
          const score = ctx.scored[file].result.fitScore;
          assert.ok(Number.isInteger(score) && score >= 0 && score <= 100, `${entry.name}: ${score}`);
          assert.equal(ctx.scored[file].candidate.parsedData.parseError, undefined, `${entry.name}: the model could not parse the resume`);
        }
        const scan = await scoreFile(SCAN, "Sana Scanned");
        assert.equal(scan.result.fitScore, 0);
        assert.equal(scan.result.manualReview, true);
        const scores = Object.entries(EXPECTED_SKILLS).map(([file, e]) => `${e.name.split(" ")[0]} ${ctx.scored[file].result.fitScore}`).join(", ");
        return `${scores}, scan 0 · all 8 parsed by the model (${stats.parseRetries} waits for the rate limit)`;
      },
    },
    {
      id: "S7-02",
      title: "The ranking makes sense: strong beats partial beats unrelated, with clear gaps",
      requirement: "A screening model that cannot separate a DevOps engineer from an accountant is useless.",
      input: "live scores of the 3 strong, 3 partial and 2 unrelated resumes",
      expect: "average(strong) − average(partial) ≥ 15 · average(partial) − average(unrelated) ≥ 15 · the weakest strong resume scores above the best unrelated one",
      run: async (ctx) => {
        const [strong, partial, unrelated] = GROUPS.map((g) => groupScores(ctx, g));
        assert.ok(mean(strong) - mean(partial) >= 15, `strong ${fmt(mean(strong))} vs partial ${fmt(mean(partial))}`);
        assert.ok(mean(partial) - mean(unrelated) >= 15, `partial ${fmt(mean(partial))} vs unrelated ${fmt(mean(unrelated))}`);
        assert.ok(Math.min(...strong) > Math.max(...unrelated));
        return `averages: strong ${fmt(mean(strong))} · partial ${fmt(mean(partial))} · unrelated ${fmt(mean(unrelated))} · weakest strong ${Math.min(...strong)} > best unrelated ${Math.max(...unrelated)}`;
      },
    },
    {
      id: "S7-03",
      title: "With the real scores and the real shortlist rule, nobody unsuitable is shortlisted",
      requirement: "The costly mistake is inviting the wrong people: no false positives; at most one strong candidate missed.",
      input: "minFitScore 70, maxShortlist 3, the live scores (the scanned PDF counts as 0)",
      expect: "no partial, unrelated or unreadable candidate shortlisted; at least 2 of the 3 strong candidates shortlisted",
      run: async (ctx) => {
        const pool = Object.entries(EXPECTED_SKILLS).map(([file, e], i) => ({ id: file, fitScore: ctx.scored[file].result.fitScore, appliedAt: new Date(Date.UTC(2026, 9, i + 1)).toISOString() }));
        pool.push({ id: SCAN, fitScore: 0, appliedAt: new Date(Date.UTC(2026, 9, 12)).toISOString() });
        const { shortlisted } = decideShortlist(pool, { minFitScore: 70, maxShortlist: 3 });
        const strongInList = shortlisted.filter((id) => EXPECTED_SKILLS[id]?.group === "strong");
        assert.equal(strongInList.length, shortlisted.length, `unsuitable shortlisted: ${shortlisted.filter((id) => EXPECTED_SKILLS[id]?.group !== "strong")}`);
        assert.ok(strongInList.length >= 2, `only ${strongInList.length} strong candidates shortlisted`);
        return `shortlisted ${shortlisted.map((id) => EXPECTED_SKILLS[id].name.split(" ")[0]).join(", ")} (${strongInList.length} of 3 strong, 0 unsuitable)`;
      },
    },
    {
      id: "S7-04",
      title: "The model's explanations are name-free and its skill claims are checked against the resume",
      requirement: "Name scrubbing and the hallucination guard also hold on real model output.",
      input: "the nine live analyses",
      expect: "no stored explanation contains the candidate's first or last name; matched skills equal the hand-written expectations whatever the model claimed",
      run: async (ctx) => {
        let unverified = 0;
        for (const [file, entry] of Object.entries(EXPECTED_SKILLS)) {
          const { result } = ctx.scored[file];
          const text = JSON.stringify({ r: result.rationale, s: result.strengths, c: result.concerns, e: result.educationMatch });
          for (const token of entry.name.split(" ")) assert.ok(!new RegExp(`\\b${token}\\b`, "i").test(text), `${entry.name}: "${token}" appears in the explanation`);
          assert.deepEqual(result.skillMatch.matched, entry.matched, entry.name);
          unverified += result.skillMatch.unverified?.length || 0;
        }
        return `0 names in 9 explanations · matched skills equal the hand-written lists for all 8 readable resumes · model claims the resume did not support: ${unverified}`;
      },
    },
    {
      id: "S7-05",
      title: "Scoring the same resume again gives nearly the same score",
      requirement: "Repeatability: a candidate's fate should not depend on luck (temperature 0.1).",
      input: "Bilal Qureshi scored a second time",
      expect: "the two scores differ by at most 10 points",
      run: async (ctx) => {
        const file = "strong-2-bilal-qureshi.txt";
        const first = ctx.scored[file].result.fitScore;
        const again = (await patiently(() => scoreCandidateFit({ job, candidate: ctx.scored[file].candidate }))).fitScore;
        assert.ok(Math.abs(first - again) <= 10, `${first} vs ${again}`);
        return `first ${first}, second ${again}, difference ${Math.abs(first - again)}`;
      },
    },
    {
      id: "S7-06",
      title: "The model writes a usable interview bank for the job",
      requirement: "generateJobQuestions + validation: right count, one warm-up first, valid categories, ideal answers and keywords (07).",
      input: "ask for 8 questions for the DevOps Engineer job",
      expect: "6-8 valid questions, no duplicates, warm-up first, each with an ideal answer and 2-8 keywords, at least 3 mentioning a required skill",
      run: async () => {
        const questions = await generateJobQuestions({ job, count: 8 }, { llm: patientLlm });
        assert.ok(questions.length >= 6 && questions.length <= 8, `${questions.length} questions`);
        assert.equal(questions[0].isWarmup, true);
        assert.equal(new Set(questions.map((q) => q.question.toLowerCase())).size, questions.length);
        for (const q of questions) {
          assert.ok(CATEGORIES.includes(q.category) && DIFFICULTIES.includes(q.difficulty));
          assert.ok(q.idealAnswer.length > 20 && q.expectedKeywords.length >= 2 && q.expectedKeywords.length <= 8);
        }
        const skillRelated = questions.filter((q) => REQUIRED.some((skill) => skillAppearsIn(skill, `${q.question} ${q.expectedKeywords.join(" ")}`))).length;
        assert.ok(skillRelated >= 3, `${skillRelated} skill-related questions`);
        return `${questions.length} questions · categories ${[...new Set(questions.map((q) => q.category))].join("/")} · ${skillRelated} mention a required skill · first: "${questions[0].question.slice(0, 50)}…"`;
      },
    },
    {
      id: "S7-07",
      title: "The model scores a strong spoken answer high and \"I don't know, maybe Docker\" low",
      requirement: "The interview score rests on this judgement; the two fixture answers (q1-strong / q1-weak) must be far apart.",
      input: "the transcripts of tests/fixtures/interview/answers/q1-strong.wav and q1-weak.wav against one CI/CD question",
      expect: "strong ≥ 70, weak ≤ 40, gap ≥ 30",
      run: async () => {
        const question = {
          question: "How would you set up a CI/CD pipeline for a containerised service?", category: "technical",
          idealAnswer: "Build and test on every pull request, push a versioned image to a registry, deploy to Kubernetes with Helm, provision infrastructure with Terraform and roll back automatically when health checks fail.",
          expectedKeywords: ["docker", "kubernetes", "helm", "terraform", "rollback"],
        };
        const strongText = "I would build the Docker image on every pull request, run the unit tests, push it to a registry, and deploy to Kubernetes with Helm. Terraform manages the AWS infrastructure, and a failed health check rolls the release back automatically.";
        const strong = await scoreAnswer(strongText, question, { llm: patientLlm });
        const weak = await scoreAnswer("I don't know, maybe Docker.", question, { llm: patientLlm });
        assert.equal(strong.fallback, false, "the real model must have answered (not the keyword fallback)");
        assert.ok(strong.score >= 70, `strong answer scored ${strong.score}`);
        assert.ok(weak.score <= 40, `weak answer scored ${weak.score}`);
        assert.ok(strong.score - weak.score >= 30);
        return `strong ${strong.score}, weak ${weak.score}, gap ${strong.score - weak.score}`;
      },
    },
  ],
};
