// Stage 6: the whole pipeline on the real (local) Postgres database, with throw-away data.
// Real: the public apply endpoint, resume storage, screening, shortlist (with its advisory lock), invites,
// token checks, the interview session writing real rows, finalisation and recruiter decisions.
// Fake: the language model (scripted answers), e-mail (a mailbox array), the job queue (an array), Redis
// (a counter map), the clock inside the interview, and the recording analysis output (inserted as data).
// Everything is created under one new recruiter and deleted again at the end (S6-21).
import assert from "node:assert/strict";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db } from "../../libs/db";
import {
  candidates, interviewQuestions, interviewResponses, interviewTurns, interviews, jobs, notifications, users,
} from "../../libs/schema";
import { setLlmClient } from "../../libs/ai/llm";
import { scoreCandidateFit, screenCandidate } from "../../libs/hiring/fit-scorer";
import { applyShortlist } from "../../libs/hiring/shortlist";
import { queueAfterShortlist } from "../../libs/hiring/shortlist-hooks";
import { InviteError, cancelInvite, extendInvite, sendInvite } from "../../libs/hiring/invitations";
import { AccessError, markOpened, resolveInterviewToken } from "../../libs/interview/public-access";
import * as repository from "../../libs/interview/repository";
import { InterviewSession } from "../../libs/interview/session-engine";
import { toCandidateContext, toRoleContext, toSessionQuestions } from "../../libs/interview/mappers";
import { scoreAnswer } from "../../libs/interview/answer-scorer";
import { finalizeCandidate } from "../../libs/hiring/finalize";
import { DecisionError, applyDecision, bulkApprove } from "../../libs/hiring/decisions";
import { listKeys } from "../../libs/hiring/storage";
import { createFakeClock } from "../hiring/helpers/fake-clock";
import { Skip } from "./runner";
import { installTripwire } from "./tripwire";
import { FIXTURES, SCRIPTED_FIT, EXPECTED_SKILLS, job as jobFixture, list } from "./fixtures";

const PREFIX = "demo-hiring-";

const APPLICANTS = [
  { file: "strong-1-ayesha-khan.pdf", name: "Ayesha Khan", email: "ayesha.khan@example.com" },
  { file: "strong-2-bilal-qureshi.txt", name: "Bilal Qureshi", email: "bilal.qureshi@example.com" },
  { file: "strong-3-sara-ahmed.docx", name: "Sara Ahmed", email: "sara.ahmed@example.com" },
  { file: "partial-3-usman-tariq.pdf", name: "Usman Tariq", email: "usman.tariq@example.com" },
  { file: "partial-1-hamza-sheikh.txt", name: "Hamza Sheikh", email: "hamza.sheikh@example.com" },
  { file: "partial-2-fatima-noor.txt", name: "Fatima Noor", email: "fatima.noor@example.com" },
  { file: "unrelated-1-zara-malik.txt", name: "Zara Malik", email: "zara.malik@example.com" },
  { file: "unrelated-2-omar-farooq.txt", name: "Omar Farooq", email: "omar.farooq@example.com" },
  { file: "unreadable-scanned.pdf", name: "Sana Scanned", email: "sana.scanned@example.com" },
];

// The interview bank for the throw-away job: [question, category, ideal answer, keywords, weight, the score the scripted scorer gives]
const BANK = [
  ["How would you set up a CI/CD pipeline for a containerised service?", "technical", "Build and test on each commit, push an image, deploy with Helm, roll back on failure.", ["docker", "helm", "rollback"], 2, 90],
  ["Tell me about a production incident you handled.", "behavioral", "A clear situation, actions, outcome and what changed afterwards.", [], 1, 70],
  ["How do you manage infrastructure as code?", "technical", "Terraform modules, remote state, reviews, environments from code.", ["terraform", "state"], 2, 80],
];
const ANSWERS = [
  "I build the image on every pull request, run the tests, push to a registry and deploy with Helm, and a failed health check rolls the release back.",
  "Last year a bad config took down our payments service. I rolled back, wrote a post-mortem and added a deploy check.",
  "Everything lives in Terraform modules with remote state and reviewed pull requests, and each environment is created from code.",
];
// By hand: (90 × 2 + 70 × 1 + 80 × 2) / (2 + 1 + 2) = 410 / 5 = 82
const EXPECTED_INTERVIEW_SCORE = 82;

const mailbox = () => {
  const sent = [];
  return { sent, deliver: async (mail) => { sent.push(mail); return { delivered: "demo-mailbox", to: mail.to }; } };
};
const jobQueue = () => {
  const queued = [];
  return { queued, enqueue: async (type, payload) => { queued.push({ type, payload }); } };
};
const fakeRedis = () => {
  const counts = new Map();
  return { incr: async (key) => { counts.set(key, (counts.get(key) || 0) + 1); return counts.get(key); }, expire: async () => 1, ttl: async () => 3000 };
};
const quiet = async () => {};

async function until(check, what, ms = 15000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

const getCandidate = async (id) => (await db.select().from(candidates).where(eq(candidates.id, id)).limit(1))[0];
const getInterview = async (id) => (await db.select().from(interviews).where(eq(interviews.id, id)).limit(1))[0];
const statusOf = async (ctx, email) => (await getCandidate(ctx.ids[email])).status;
const first = (name) => name.split(" ")[0];

async function applyThroughRoute(ctx, { file, name, email, filename = file, jobId = ctx.job.id }) {
  const form = new FormData();
  form.append("name", name);
  form.append("email", email);
  if (file) form.append("resume", new File([fs.readFileSync(`${FIXTURES}/resumes/${file}`)], filename));
  const request = new Request("http://localhost/api/hiring/apply", { method: "POST", body: form });
  const response = await ctx.route.POST(request, { params: { jobId } });
  return { status: response.status, body: await response.json() };
}

/** A candidate who has already finished an interview, inserted directly (used for the automation guard rails). */
async function seedCompleted(ctx, { name, email, fitScore, scores }) {
  const [candidate] = await db.insert(candidates).values({
    jobId: ctx.job.id, userId: ctx.user.id, name, email, status: "interview_completed", fitScore, parsedData: {}, source: "direct",
  }).returning();
  const snapshot = ctx.questions.map((q) => ({ id: q.id, question: q.question, category: q.category, idealAnswer: q.idealAnswer, expectedKeywords: q.expectedKeywords, scoreWeight: q.scoreWeight }));
  const responses = scores.map((score, i) => ({ questionId: ctx.questions[i].id, score }));
  const [interview] = await db.insert(interviews).values({
    userId: ctx.user.id, jobId: ctx.job.id, candidateId: candidate.id, status: "completed", tokenHash: crypto.randomBytes(32).toString("hex"),
    expiresAt: new Date(Date.now() + 86400000), questionSnapshot: snapshot, state: { totalQuestions: 3 }, totalQuestions: 3,
    totalAnswers: scores.length, interviewScore: repository.computeInterviewScore(responses, snapshot), endedAt: new Date(),
  }).returning();
  for (let i = 0; i < scores.length; i += 1) {
    await db.insert(interviewResponses).values({
      interviewId: interview.id, questionId: ctx.questions[i].id, questionText: ctx.questions[i].question, answer: `Seeded answer ${i + 1}`,
      isFollowUp: false, followUpDepth: 0, score: scores[i], answeredAt: new Date(),
    });
  }
  return { candidateId: candidate.id, interviewId: interview.id };
}

async function runInterview(ctx, interviewId) {
  const { interview, job, candidate } = await repository.loadSessionContext(interviewId);
  const snapshot = await repository.ensureQuestionSnapshot(interview);
  const questions = toSessionQuestions(snapshot.map((q, i) => ({ ...q, orderIndex: i })));
  const clock = createFakeClock();
  const sent = [];
  const queue = jobQueue();
  const scoreByText = new Map(BANK.map((b) => [b[0], b[5]]));
  const session = new InterviewSession({
    interview: { ...interview, totalQuestions: questions.length },
    job,
    candidate,
    questions,
    config: { maxFollowUps: 0, interviewMaxMinutes: 25, silenceMs: 8000 },
    candidateContext: toCandidateContext(candidate),
    roleContext: toRoleContext(job),
    state: null,
    pausedAt: null,
    deps: {
      analyze: async () => ({ shouldFollowUp: false, reasons: [], reasonForFollowUp: null }),
      followUp: async () => ({ question: "Can you give an example?", fallback: true }),
      score: (answer, question) => scoreAnswer(answer, question, {
        llm: async () => ({ score: scoreByText.get(question.question), reasoning: "Scripted score for the demo", keywordsCovered: [], keywordsMissed: [] }),
      }),
      tts: async () => null,
      repo: {
        markStarted: (i, o) => repository.markStarted(i, o),
        appendTurn: (id, turn) => repository.appendTurn(id, turn),
        createResponse: (id, response) => repository.createResponse(id, response),
        updateResponseScore: (id, result) => repository.updateResponseScore(id, result),
        saveState: (id, state) => repository.saveState(id, state),
        recordIntegrityEvent: (id, event) => repository.recordIntegrityEvent(id, event),
        complete: (i, o) => repository.completeInterview(i, o),
        abandon: (i, o) => repository.abandonInterview(i, o),
      },
      send: (type, payload) => sent.push({ type, ...payload }),
      publish: () => {},
      enqueue: queue.enqueue,
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    },
  });
  const ofType = (type) => sent.filter((m) => m.type === type);
  const ack = () => session.onAiDoneSpeaking(ofType("ai_speaking").at(-1).turnId);

  await session.start({ resume: false });
  await until(() => ofType("ai_speaking").length >= 1, "the greeting");
  ack();
  session.onSttFinal("yes I am ready", {});
  await until(() => ofType("question").length >= 1, "question 1");
  ack();
  for (let i = 0; i < ANSWERS.length; i += 1) {
    session.onSttFinal(ANSWERS[i], {});
    session.onAnswerDone();
    if (i < ANSWERS.length - 1) {
      await until(() => ofType("question").length >= i + 2, `question ${i + 2}`);
      ack();
    } else {
      await until(() => ofType("ai_speaking").at(-1)?.kind === "closing", "the closing words");
      ack();
      await until(() => ofType("interview_complete").length >= 1, "the interview to complete");
    }
  }
  return { sent, queued: queue.queued, questionTexts: ofType("question").map((q) => q.text) };
}

export default {
  id: 6,
  title: "One candidate through the real database",
  tier: "database",
  intro: "Throw-away recruiter, job and nine applicants in real Postgres. The AI, e-mail and queue are scripted; everything else is the real code.",
  async setup() {
    if (!process.env.DATABASE_URL) throw new Skip("DATABASE_URL is not set (see .env.example)");
    try {
      await Promise.race([db.execute(sql`select 1`), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000))]);
    } catch (error) {
      throw new Skip(`database not reachable (${error.message})`);
    }

    // Leftovers of a run that was killed half way (the prefix is unique to this script)
    await db.delete(users).where(like(users.id, `${PREFIX}%`));

    const saved = { driver: process.env.STORAGE_DRIVER, dir: process.env.STORAGE_LOCAL_DIR };
    const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "raasta-demo-storage-"));
    process.env.STORAGE_DRIVER = "local";
    process.env.STORAGE_LOCAL_DIR = storageDir;

    const ctx = { saved, storageDir, ids: {}, byId: {}, mail: mailbox(), queue: jobQueue(), parseCalls: 0, parsedFiles: [], interviewIds: [] };
    // Stands in for the model that reads a resume when someone applies
    setLlmClient({
      chat: {
        completions: {
          create: async () => {
            ctx.parseCalls += 1;
            return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ skills: [], summary: "Parsed by the demo's scripted parser" }) } }] };
          },
        },
      },
    });

    const id = `${PREFIX}${crypto.randomUUID()}`;
    await db.insert(users).values({ id, email: `${id}@raasta.test`, name: "Demo Recruiter", role: "recruiter", modes: ["recruiter"] });
    ctx.user = { id, name: "Demo Recruiter" };
    const [job] = await db.insert(jobs).values({
      userId: id, title: jobFixture.title, requiredSkills: jobFixture.requiredSkills, techStack: jobFixture.techStack,
      experienceRange: jobFixture.experienceRange, location: jobFixture.location, locationType: jobFixture.locationType,
      employmentType: jobFixture.employmentType, formalDescription: jobFixture.formalDescription, status: "published",
      hiringConfig: { autoScreen: false, minFitScore: 70, maxShortlist: 3, autoInvite: true, inviteExpiryHours: 72, autoFinalize: false, finalThreshold: 70, interviewMaxMinutes: 25 },
    }).returning();
    ctx.job = job;
    ctx.questions = await db.insert(interviewQuestions).values(BANK.map(([question, category, idealAnswer, expectedKeywords, scoreWeight], i) => ({
      userId: id, jobId: job.id, question, category, idealAnswer, expectedKeywords, scoreWeight, orderIndex: i, source: "manual",
    }))).returning();
    ctx.route = await import("../../app/api/hiring/apply/[jobId]/route.js");
    return ctx;
  },
  async teardown(ctx) {
    if (!ctx.cleaned && ctx.user) await db.delete(users).where(eq(users.id, ctx.user.id)).catch(() => {});
    if (ctx.storageDir) fs.rmSync(ctx.storageDir, { recursive: true, force: true });
    for (const [key, value] of [["STORAGE_DRIVER", ctx.saved?.driver], ["STORAGE_LOCAL_DIR", ctx.saved?.dir]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    installTripwire();
  },
  cases: [
    {
      id: "S6-01",
      title: "Set-up: a throw-away recruiter, a published DevOps job and a 3-question interview bank exist",
      requirement: "Everything this stage does is under one new recruiter and is removed again at the end.",
      input: "insert user, job (min fit 70, top 3, 72 h invites, human decides) and 3 active questions",
      expect: "1 job with the six required skills, 3 active job-wide questions",
      run: async (ctx) => {
        const job = (await db.select().from(jobs).where(eq(jobs.id, ctx.job.id)))[0];
        const questions = await db.select().from(interviewQuestions).where(and(eq(interviewQuestions.jobId, job.id), eq(interviewQuestions.isActive, true)));
        assert.deepEqual(job.requiredSkills, jobFixture.requiredSkills);
        assert.equal(questions.length, 3);
        return `job "${job.title}" (${job.requiredSkills.length} required skills), ${questions.length} questions, owner ${ctx.user.id.slice(0, 18)}…`;
      },
    },
    {
      id: "S6-02",
      title: "Nine candidates apply through the real public endpoint with their resume files",
      requirement: "POST /api/hiring/apply/[jobId]: validate, store the file, read the text, create the candidate (06 §1).",
      input: "PDF, DOCX and TXT resumes of 8 people plus one scanned PDF",
      expect: "9 × HTTP 200, 9 candidates with status new, 9 files in storage, the AI parser used 8 times (not for the scan), the scan flagged unreadable",
      run: async (ctx) => {
        for (const applicant of APPLICANTS) {
          const { status, body } = await applyThroughRoute(ctx, applicant);
          assert.equal(status, 200, `${applicant.name}: ${JSON.stringify(body)}`);
          ctx.ids[applicant.email] = body.candidateId;
          ctx.byId[body.candidateId] = applicant;
        }
        const rows = await db.select().from(candidates).where(eq(candidates.jobId, ctx.job.id));
        assert.equal(rows.length, 9);
        assert.ok(rows.every((r) => r.status === "new" && r.resumeKey));
        const keys = await listKeys(`resumes/${ctx.job.id}/`);
        assert.equal(keys.length, 9);
        assert.equal(ctx.parseCalls, 8);
        const scanned = rows.find((r) => r.email === "sana.scanned@example.com");
        assert.equal(scanned.parsedData.parseError, "Could not extract readable text from resume");
        return `9 applications accepted · ${keys.length} files stored · parser used ${ctx.parseCalls} times · scan flagged "${scanned.parsedData.parseError}"`;
      },
    },
    {
      id: "S6-03",
      title: "Applying twice with the same e-mail is refused (HTTP 409)",
      requirement: "One application per person per job; the second does not create a row (Phase 1 acceptance).",
      input: "the duplicate-email fixture (Bilal Qureshi again, with different capitals in the e-mail)",
      expect: "409 \"You have already applied for this position\"; still exactly one Bilal row",
      run: async (ctx) => {
        const { status, body } = await applyThroughRoute(ctx, { file: "duplicate-email-bilal-qureshi.txt", name: "Bilal Qureshi", email: "Bilal.Qureshi@Example.com" });
        assert.equal(status, 409);
        assert.equal(body.error, "You have already applied for this position");
        const rows = await db.select().from(candidates).where(and(eq(candidates.jobId, ctx.job.id), sql`lower(${candidates.email}) = 'bilal.qureshi@example.com'`));
        assert.equal(rows.length, 1);
        return `HTTP ${status} "${body.error}" · rows for this e-mail: ${rows.length}`;
      },
    },
    {
      id: "S6-04",
      title: "A wrong file type and a broken job link are rejected cleanly",
      requirement: "Bad input gets a clear 4xx, never a crash and never a stored row.",
      input: "an .exe sent as the resume · an application to a job id that is not a UUID",
      expect: "400 \"Resume must be a PDF, DOCX or TXT file\" · 404 \"Job not found\" · still 9 candidates",
      run: async (ctx) => {
        const exe = await applyThroughRoute(ctx, { file: "partial-1-hamza-sheikh.txt", filename: "resume.exe", name: "Mallory", email: "mallory@example.com" });
        assert.equal(exe.status, 400);
        assert.match(exe.body.error, /PDF, DOCX or TXT/);
        const bad = await applyThroughRoute(ctx, { file: "partial-1-hamza-sheikh.txt", name: "Mallory", email: "mallory@example.com", jobId: "not-a-uuid" });
        assert.equal(bad.status, 404);
        const [{ n }] = await db.select({ n: sql`count(*)::int` }).from(candidates).where(eq(candidates.jobId, ctx.job.id));
        assert.equal(n, 9);
        return `.exe → ${exe.status} "${exe.body.error}" · bad job link → ${bad.status} · candidates still ${n}`;
      },
    },
    {
      id: "S6-05",
      title: "Screening writes each fit score, moves everyone to \"screened\", and keeps names out of the explanation",
      requirement: "screenCandidate saves fitScore + fitAnalysis and new → screened (06 §2).",
      input: "scripted AI scores (Ayesha 92 … Omar 5); the scripted explanation deliberately contains each candidate's own name",
      expect: "9 rows screened with the scripted scores (scan = 0); no stored explanation contains a candidate's name",
      run: async (ctx) => {
        for (const [email, id] of Object.entries(ctx.ids)) {
          await screenCandidate(id, {
            scorer: ({ job, candidate }) => scoreCandidateFit({ job, candidate }, {
              llm: async () => ({ fitScore: SCRIPTED_FIT[email], rationale: `${candidate.name} matches part of the stack.`, strengths: [`${first(candidate.name)} knows some tools`] }),
            }),
          });
        }
        const rows = await db.select().from(candidates).where(eq(candidates.jobId, ctx.job.id));
        assert.ok(rows.every((r) => r.status === "screened" && r.screenedAt));
        for (const r of rows) {
          const expected = r.email in SCRIPTED_FIT ? SCRIPTED_FIT[r.email] : 0;
          assert.equal(r.fitScore, expected, r.email);
          assert.ok(!JSON.stringify(r.fitAnalysis).includes(first(r.name)), `${r.name}'s name is stored in the analysis`);
        }
        const scan = rows.find((r) => r.email === "sana.scanned@example.com");
        assert.equal(scan.fitAnalysis.manualReview, true);
        return rows.sort((a, b) => b.fitScore - a.fitScore).map((r) => `${first(r.name)} ${r.fitScore}`).join(", ");
      },
    },
    {
      id: "S6-06",
      title: "The stored skill analysis shows exactly which skills each resume proves",
      requirement: "fit_analysis.skillMatch is recomputed from the resume text, not trusted from the AI.",
      input: "stored analysis of Ayesha (strong), Hamza (partial), Zara (unrelated)",
      expect: "Ayesha 6 matched · Hamza Docker, AWS, Linux (missing Kubernetes, CI/CD, Terraform) · Zara none",
      run: async (ctx) => {
        const parts = [];
        for (const file of ["strong-1-ayesha-khan.pdf", "partial-1-hamza-sheikh.txt", "unrelated-1-zara-malik.txt"]) {
          const applicant = APPLICANTS.find((a) => a.file === file);
          const row = await getCandidate(ctx.ids[applicant.email]);
          assert.deepEqual(row.fitAnalysis.skillMatch.matched, EXPECTED_SKILLS[file].matched, applicant.name);
          assert.deepEqual(row.fitAnalysis.skillMatch.missing, EXPECTED_SKILLS[file].missing, applicant.name);
          parts.push(`${first(applicant.name)}: ${list(row.fitAnalysis.skillMatch.matched)}`);
        }
        return parts.join(" · ");
      },
    },
    {
      id: "S6-07",
      title: "The shortlist picks Ayesha, Bilal and Sara; everyone else is \"not shortlisted\"",
      requirement: "applyShortlist: threshold 70 and cap 3 on the real rows, then queue question generation and the invites (06 §3).",
      input: "minFitScore 70, maxShortlist 3 on the nine screened candidates",
      expect: "3 shortlisted in the database, 6 not shortlisted; the queue receives ensure-questions once and send-invite ×3",
      run: async (ctx) => {
        const result = await applyShortlist(ctx.job.id, {
          triggeredBy: "demo",
          onShortlisted: (ids, c) => queueAfterShortlist(ids, c, { enqueueJob: ctx.queue.enqueue, isManaged: async () => false }),
        });
        const names = (ids) => ids.map((id) => first(ctx.byId[id].name));
        assert.deepEqual(names(result.shortlisted), ["Ayesha", "Bilal", "Sara"]);
        assert.equal(result.notShortlisted.length, 6);
        for (const email of ["ayesha.khan@example.com", "bilal.qureshi@example.com", "sara.ahmed@example.com"]) assert.equal(await statusOf(ctx, email), "shortlisted");
        for (const email of ["usman.tariq@example.com", "hamza.sheikh@example.com", "fatima.noor@example.com", "zara.malik@example.com", "omar.farooq@example.com", "sana.scanned@example.com"]) {
          assert.equal(await statusOf(ctx, email), "not_shortlisted", email);
        }
        const types = ctx.queue.queued.map((q) => q.type);
        assert.equal(types.filter((t) => t === "ensure-questions").length, 1);
        assert.equal(types.filter((t) => t === "send-invite").length, 3);
        return `shortlisted: ${names(result.shortlisted).join(", ")} · not shortlisted: ${result.notShortlisted.length} · queued: ${types.join(", ")}`;
      },
    },
    {
      id: "S6-08",
      title: "Running the shortlist again changes nothing and queues nothing",
      requirement: "Idempotent: decided candidates are not reshuffled when the button is pressed twice.",
      input: "applyShortlist a second time",
      expect: "0 newly shortlisted, 0 newly rejected, statuses unchanged, queue unchanged",
      run: async (ctx) => {
        const before = ctx.queue.queued.length;
        const result = await applyShortlist(ctx.job.id, { triggeredBy: "demo", onShortlisted: (ids, c) => queueAfterShortlist(ids, c, { enqueueJob: ctx.queue.enqueue, isManaged: async () => false }) });
        assert.equal(result.shortlisted.length, 0);
        assert.equal(result.notShortlisted.length, 0);
        assert.equal(result.alreadyShortlisted, 3);
        assert.equal(ctx.queue.queued.length, before);
        return `shortlisted ${result.shortlisted.length}, not shortlisted ${result.notShortlisted.length}, already shortlisted counted: ${result.alreadyShortlisted}, queue +${ctx.queue.queued.length - before}`;
      },
    },
    {
      id: "S6-09",
      title: "Ayesha is invited: one interview row, one e-mail, and only a hash of the link in the database",
      requirement: "sendInvite creates the interview (72 h), moves the candidate to interview_invited and mails the link (08 §2).",
      input: "sendInvite(Ayesha) with a mailbox instead of Mailgun",
      expect: "interview status invited, expiry ≈ 72 h, candidate interview_invited, 1 e-mail to her address, the e-mailed token appears nowhere in the stored rows",
      run: async (ctx) => {
        const id = ctx.ids["ayesha.khan@example.com"];
        const result = await sendInvite(id, {}, { deliver: ctx.mail.deliver, enqueueJob: ctx.queue.enqueue, publish: quiet });
        const mail = ctx.mail.sent.at(-1);
        assert.equal(ctx.mail.sent.length, 1);
        assert.equal(mail.to, "ayesha.khan@example.com");
        const token = mail.text.match(/\/interview\/([A-Za-z0-9_-]{43})/)?.[1];
        assert.ok(token, "the e-mail must contain the interview link");
        const interview = await getInterview(result.interviewId);
        const candidate = await getCandidate(id);
        assert.equal(interview.status, "invited");
        assert.equal(candidate.status, "interview_invited");
        const hours = (new Date(interview.expiresAt) - new Date(interview.invitedAt)) / 3600000;
        assert.ok(Math.abs(hours - 72) < 0.1, `expiry after ${hours} h`);
        assert.equal(interview.tokenHash, crypto.createHash("sha256").update(token).digest("hex"));
        assert.ok(!JSON.stringify(interview).includes(token) && !JSON.stringify(candidate).includes(token));
        ctx.ayesha = { interviewId: result.interviewId, token };
        return `interview ${interview.status}, expires in ${hours.toFixed(0)} h, candidate ${candidate.status}, e-mail "${mail.subject}", link token not stored`;
      },
    },
    {
      id: "S6-10",
      title: "Pressing \"send invite\" twice does not send a second e-mail or create a second interview",
      requirement: "send-invite is idempotent, so a retried queue job cannot spam a candidate (08 §2).",
      input: "sendInvite(Ayesha) again",
      expect: "skipped \"already invited\", still 1 e-mail and 1 interview row",
      run: async (ctx) => {
        const id = ctx.ids["ayesha.khan@example.com"];
        const result = await sendInvite(id, {}, { deliver: ctx.mail.deliver, enqueueJob: ctx.queue.enqueue, publish: quiet });
        const rows = await db.select().from(interviews).where(eq(interviews.candidateId, id));
        assert.equal(result.skipped, "already invited");
        assert.equal(rows.length, 1);
        assert.equal(ctx.mail.sent.length, 1);
        return `skipped: "${result.skipped}" · interviews ${rows.length} · e-mails ${ctx.mail.sent.length}`;
      },
    },
    {
      id: "S6-11",
      title: "A candidate who was not shortlisted cannot be invited",
      requirement: "Invites only go to shortlisted (or re-invited) candidates; status is checked in the database.",
      input: "sendInvite(Usman Tariq), status not_shortlisted",
      expect: "InviteError invalid_status (HTTP 409), no e-mail, no interview row",
      run: async (ctx) => {
        const id = ctx.ids["usman.tariq@example.com"];
        const before = ctx.mail.sent.length;
        await assert.rejects(sendInvite(id, {}, { deliver: ctx.mail.deliver, enqueueJob: ctx.queue.enqueue, publish: quiet }), (e) => e instanceof InviteError && e.code === "invalid_status" && e.status === 409);
        const rows = await db.select().from(interviews).where(eq(interviews.candidateId, id));
        assert.equal(rows.length, 0);
        assert.equal(ctx.mail.sent.length, before);
        return "refused with invalid_status / 409; no e-mail, no interview";
      },
    },
    {
      id: "S6-12",
      title: "The link opens for its owner only: wrong links get 404 and hammering gets 429",
      requirement: "resolveInterviewToken checks the hash, the status and the per-link rate limit (10 §2).",
      input: "Ayesha's real link, a random valid-looking link, and 21 rapid \"consent\" requests",
      expect: "real link resolves (invited → opened on first visit) · random link AccessError not_found 404 · the 21st rapid request AccessError rate_limited 429",
      run: async (ctx) => {
        const redis = fakeRedis();
        const found = await resolveInterviewToken(ctx.ayesha.token, { redis });
        assert.equal(found.interview.id, ctx.ayesha.interviewId);
        const opened = await markOpened(found.interview);
        assert.equal(opened.status, "opened");
        const random = crypto.randomBytes(32).toString("base64url");
        await assert.rejects(resolveInterviewToken(random, { redis }), (e) => e instanceof AccessError && e.code === "not_found" && e.status === 404);
        let limited = null;
        for (let i = 1; i <= 21 && !limited; i += 1) {
          try { await resolveInterviewToken(ctx.ayesha.token, { route: "consent", redis }); } catch (e) { limited = { i, e }; }
        }
        assert.equal(limited.i, 21);
        assert.ok(limited.e instanceof AccessError && limited.e.code === "rate_limited" && limited.e.status === 429);
        return `real link → ${opened.status} · random link → 404 · request #${limited.i} within the hour → 429`;
      },
    },
    {
      id: "S6-13",
      title: "An invite left unused expires in the database; the recruiter can extend it",
      requirement: "Past expiry the link answers 410 and the candidate becomes interview_expired; extendInvite revives it (08 §4).",
      input: "invite Bilal, open his link 100 hours later, then extend by 24 hours",
      expect: "410 expired; interview expired + candidate interview_expired; after extending: interview invited again, candidate interview_invited",
      run: async (ctx) => {
        const id = ctx.ids["bilal.qureshi@example.com"];
        const invited = await sendInvite(id, {}, { deliver: ctx.mail.deliver, enqueueJob: ctx.queue.enqueue, publish: quiet });
        const token = ctx.mail.sent.at(-1).text.match(/\/interview\/([A-Za-z0-9_-]{43})/)[1];
        const later = new Date(Date.now() + 100 * 3600 * 1000);
        await assert.rejects(resolveInterviewToken(token, { redis: fakeRedis(), now: later }), (e) => e instanceof AccessError && e.code === "expired" && e.status === 410);
        assert.equal((await getInterview(invited.interviewId)).status, "expired");
        assert.equal(await statusOf(ctx, "bilal.qureshi@example.com"), "interview_expired");
        await extendInvite(invited.interviewId, 24, { publish: quiet });
        assert.equal((await getInterview(invited.interviewId)).status, "invited");
        assert.equal(await statusOf(ctx, "bilal.qureshi@example.com"), "interview_invited");
        return "expired → 410, candidate interview_expired · extended +24 h → invited again, candidate interview_invited";
      },
    },
    {
      id: "S6-14",
      title: "Cancelling an invite kills the link and puts the candidate back on the shortlist",
      requirement: "cancelInvite: interview cancelled, candidate shortlisted; the old link looks like any unknown link (08 §4).",
      input: "invite Sara, cancel it, open the old link",
      expect: "interview cancelled, candidate shortlisted, old link refused (HTTP 410) with the same \"no longer valid\" message an unknown link gets",
      run: async (ctx) => {
        const id = ctx.ids["sara.ahmed@example.com"];
        const invited = await sendInvite(id, {}, { deliver: ctx.mail.deliver, enqueueJob: ctx.queue.enqueue, publish: quiet });
        const token = ctx.mail.sent.at(-1).text.match(/\/interview\/([A-Za-z0-9_-]{43})/)[1];
        await cancelInvite(invited.interviewId, { publish: quiet });
        assert.equal((await getInterview(invited.interviewId)).status, "cancelled");
        assert.equal(await statusOf(ctx, "sara.ahmed@example.com"), "shortlisted");
        let refusal;
        await assert.rejects(resolveInterviewToken(token, { redis: fakeRedis() }), (e) => { refusal = e; return e instanceof AccessError && e.code === "cancelled"; });
        const unknown = await resolveInterviewToken(crypto.randomBytes(32).toString("base64url"), { redis: fakeRedis() }).catch((e) => e);
        assert.equal(refusal.message, unknown.message);
        return `cancelled · candidate back to shortlisted · old link → ${refusal.status} "${refusal.message.slice(0, 32)}…" (same wording as an unknown link)`;
      },
    },
    {
      id: "S6-15",
      title: "Ayesha takes the interview: answers, scores, transcript and status changes are stored",
      requirement: "The real session engine + repository: markStarted, turns, responses, scoring, completion, analysis job (09).",
      input: "3 scripted spoken answers; the scripted scorer gives 90, 70, 80 to questions weighted 2, 1, 2",
      expect: `interview completed, 3 answers each scored, interview score ${EXPECTED_INTERVIEW_SCORE} = (90×2 + 70×1 + 80×2)/5, candidate interview_completed, a transcript saved, one analyse-interview job queued`,
      run: async (ctx) => {
        const run = await runInterview(ctx, ctx.ayesha.interviewId);
        const interview = await getInterview(ctx.ayesha.interviewId);
        const responses = await db.select().from(interviewResponses).where(eq(interviewResponses.interviewId, interview.id));
        const turns = await db.select().from(interviewTurns).where(eq(interviewTurns.interviewId, interview.id));
        assert.equal(interview.status, "completed");
        assert.equal(interview.totalAnswers, 3);
        assert.equal(interview.followUpCount, 0);
        assert.equal(interview.interviewScore, EXPECTED_INTERVIEW_SCORE);
        assert.equal(responses.length, 3);
        assert.ok(responses.every((r) => r.score != null && r.answer));
        assert.equal(await statusOf(ctx, "ayesha.khan@example.com"), "interview_completed");
        assert.ok(turns.some((t) => t.kind === "greeting") && turns.some((t) => t.kind === "closing"));
        assert.deepEqual(run.queued, [{ type: "analyse-interview", payload: { interviewId: interview.id } }]);
        ctx.interviewIds.push(interview.id);
        return `${responses.length} answers scored ${responses.map((r) => r.score).sort((a, b) => b - a).join("/")} → interview score ${interview.interviewScore} · ${turns.length} transcript turns · candidate interview_completed · analysis job queued`;
      },
    },
    {
      id: "S6-16",
      title: "Editing the question bank afterwards does not change an interview that already started",
      requirement: "Questions are frozen in interviews.question_snapshot at the first start (07, 09).",
      input: "rewrite question 1 in the bank, then read Ayesha's interview snapshot",
      expect: "snapshot still holds the original wording",
      run: async (ctx) => {
        await db.update(interviewQuestions).set({ question: "REWRITTEN AFTER THE INTERVIEW STARTED" }).where(eq(interviewQuestions.id, ctx.questions[0].id));
        const interview = await getInterview(ctx.ayesha.interviewId);
        assert.equal(interview.questionSnapshot[0].question, BANK[0][0]);
        assert.ok(!JSON.stringify(interview.questionSnapshot).includes("REWRITTEN"));
        await db.update(interviewQuestions).set({ question: BANK[0][0] }).where(eq(interviewQuestions.id, ctx.questions[0].id));
        return `snapshot question 1 = "${interview.questionSnapshot[0].question.slice(0, 40)}…" (bank edit ignored)`;
      },
    },
    {
      id: "S6-17",
      title: "Finalising: final score 86 from fit 92, interview 82, communication 85, and the recruiter still decides",
      requirement: "finalizeCandidate stores the score and a suggestion; with autoFinalize off the status does not change (11 §2, hard rule 6).",
      input: "Ayesha: fit 92, interview score 82 (from S6-15), recording analysis inserted as data (the S5-04 example: communication 85); scripted AI summary that contains her name",
      expect: "0.3×92 + 0.5×82 + 0.2×85 = 27.6 + 41 + 17 = 85.6 → 86; suggestion final_shortlisted; candidate still interview_completed; name removed from the stored summary; notification says it is waiting for the recruiter",
      run: async (ctx) => {
        await db.update(interviews).set({
          analysis: { voice: { wpm: 135, fillerPerMin: 2, pauseRatio: 0.1 }, gaze: { eyeContactScore: 80 }, emotion: { distribution: { neutral: 0.7, happy: 0.1, anxious: 0.2 } } },
          analysisStatus: "complete",
        }).where(eq(interviews.id, ctx.ayesha.interviewId));
        const notes = [];
        const id = ctx.ids["ayesha.khan@example.com"];
        const result = await finalizeCandidate({ candidateId: id, interviewId: ctx.ayesha.interviewId }, {
          llm: async () => ({ recommendation: "strong_yes", summary: "Ayesha Khan explained deployments and rollbacks clearly.", strengths: ["Ayesha has strong Terraform skills"], risks: [], suggestedNextSteps: ["Technical panel"] }),
          notifyFn: async (n) => { notes.push(n); },
          isManaged: async () => false,
          decisionDeps: { enqueueJob: ctx.queue.enqueue, deliver: ctx.mail.deliver },
        });
        const row = await getCandidate(id);
        assert.equal(row.finalScore, 86);
        assert.equal(result.suggestedDecision, "final_shortlisted");
        assert.equal(result.applied, null);
        assert.equal(row.status, "interview_completed");
        assert.deepEqual([row.finalAnalysis.breakdown.resume, row.finalAnalysis.breakdown.interview, row.finalAnalysis.communication.score], [92, 82, 85]);
        assert.doesNotMatch(JSON.stringify(row.finalAnalysis), /Ayesha|Khan/);
        assert.match(notes[0].body, /Waiting for your decision/);
        assert.equal((await getInterview(ctx.ayesha.interviewId)).communicationScore, 85);
        return `final score ${row.finalScore} · suggestion ${result.suggestedDecision} · status still ${row.status} · "${notes[0].body}"`;
      },
    },
    {
      id: "S6-18",
      title: "The recruiter approves Ayesha, then hires her; an illegal move afterwards is refused",
      requirement: "applyDecision follows the status machine and records who decided and when (11 §3).",
      input: "final_shortlisted by the recruiter, then hired, then hired → final_rejected",
      expect: "status final_shortlisted (decidedBy = the recruiter), then hired; the last move fails with invalid_transition (409) and the status stays hired; no outcome e-mail is queued (switched off)",
      run: async (ctx) => {
        const id = ctx.ids["ayesha.khan@example.com"];
        const deps = { enqueueJob: ctx.queue.enqueue, deliver: ctx.mail.deliver };
        await applyDecision({ candidateId: id, decision: "final_shortlisted", decidedBy: ctx.user.id, note: "Strong on automation" }, deps);
        const shortlisted = await getCandidate(id);
        assert.equal(shortlisted.status, "final_shortlisted");
        assert.equal(shortlisted.decidedBy, ctx.user.id);
        assert.ok(shortlisted.finalDecidedAt);
        await applyDecision({ candidateId: id, decision: "hired", decidedBy: ctx.user.id }, deps);
        await assert.rejects(applyDecision({ candidateId: id, decision: "final_rejected", decidedBy: ctx.user.id }, deps), (e) => e instanceof DecisionError && e.code === "invalid_transition" && e.status === 409);
        assert.equal(await statusOf(ctx, "ayesha.khan@example.com"), "hired");
        assert.equal(ctx.queue.queued.filter((q) => q.type === "send-outcome-email").length, 0);
        return "final_shortlisted (by the recruiter, with a note) → hired · hired → final_rejected refused (409) · status stays hired";
      },
    },
    {
      id: "S6-19",
      title: "With automatic decisions ON: clear cases are decided by the system, doubtful ones are not",
      requirement: "autoFinalize applies a decision only for a clear suggestion on a job not run by the agent (11 §2, hard rule 6).",
      input: "four finished interviews on a job with autoFinalize true: strong, weak, only 1 of 3 answered, and strong on an agent-managed job",
      expect: "strong → final_shortlisted by \"system\" · weak → final_rejected by \"system\" · 1 of 3 answered → stays interview_completed (needs_review) · agent-managed → stays interview_completed",
      run: async (ctx) => {
        await db.update(jobs).set({ hiringConfig: { ...ctx.job.hiringConfig, autoFinalize: true } }).where(eq(jobs.id, ctx.job.id));
        // By hand, with no communication data the weights become 0.375 resume / 0.625 interview:
        //   strong: interview (90×2 + 80×1 + 85×2)/5 = 86; final (0.3×90 + 0.5×86)/0.8 = 87.5 → 88
        //   weak:   interview (40×2 + 30×1 + 50×2)/5 = 42; final (0.3×30 + 0.5×42)/0.8 = 37.5 → 38
        const seeds = {
          strong: await seedCompleted(ctx, { name: "Strong Seed", email: "strong.seed@example.com", fitScore: 90, scores: [90, 80, 85] }),
          weak: await seedCompleted(ctx, { name: "Weak Seed", email: "weak.seed@example.com", fitScore: 30, scores: [40, 30, 50] }),
          thin: await seedCompleted(ctx, { name: "Thin Seed", email: "thin.seed@example.com", fitScore: 95, scores: [95] }),
          managed: await seedCompleted(ctx, { name: "Managed Seed", email: "managed.seed@example.com", fitScore: 90, scores: [90, 80, 85] }),
        };
        ctx.seeds = seeds;
        const finalize = (seed, managed = false) => finalizeCandidate({ candidateId: seed.candidateId, interviewId: seed.interviewId }, {
          llm: async () => { throw new Error("AI summary unavailable"); }, // also proves the fallback summary path
          notifyFn: async () => {}, isManaged: async () => managed, decisionDeps: { enqueueJob: ctx.queue.enqueue, deliver: ctx.mail.deliver },
        });
        const results = {
          strong: await finalize(seeds.strong), weak: await finalize(seeds.weak), thin: await finalize(seeds.thin), managed: await finalize(seeds.managed, true),
        };
        const rows = Object.fromEntries(await Promise.all(Object.entries(seeds).map(async ([k, s]) => [k, await getCandidate(s.candidateId)])));
        assert.deepEqual([rows.strong.finalScore, rows.weak.finalScore], [88, 38]);
        assert.equal(rows.strong.status, "final_shortlisted");
        assert.equal(rows.strong.decidedBy, "system");
        assert.equal(rows.weak.status, "final_rejected");
        assert.equal(rows.weak.decidedBy, "system");
        assert.equal(rows.thin.status, "interview_completed");
        assert.equal(rows.thin.finalAnalysis.suggestedDecision, "needs_review");
        assert.equal(rows.managed.status, "interview_completed");
        assert.equal(rows.managed.finalAnalysis.suggestedDecision, "final_shortlisted");
        assert.ok(Object.values(results).every((r) => r.fallbackSummary === true));
        return `strong ${rows.strong.finalScore} → ${rows.strong.status} (${rows.strong.decidedBy}) · weak ${rows.weak.finalScore} → ${rows.weak.status} (${rows.weak.decidedBy}) · 1/3 answered → ${rows.thin.status} (needs_review) · agent-managed → ${rows.managed.status}`;
      },
    },
    {
      id: "S6-20",
      title: "\"Approve all\" applies clear suggestions but never decides the doubtful ones",
      requirement: "bulkApprove skips needs_review and escalated candidates (11 §3).",
      input: "bulkApprove on the job: one waiting candidate with a clear suggestion (agent-managed seed), one needs_review (1 of 3 answered)",
      expect: "1 applied (final_shortlisted by the recruiter), 1 left for review, 0 failed; the thin one stays interview_completed",
      run: async (ctx) => {
        const result = await bulkApprove(ctx.job.id, ctx.user.id, { enqueueJob: ctx.queue.enqueue, deliver: ctx.mail.deliver });
        assert.equal(result.applied.length, 1);
        assert.equal(result.applied[0].candidateId, ctx.seeds.managed.candidateId);
        assert.equal(result.needsReview, 1);
        assert.equal(result.failed, 0);
        const managed = await getCandidate(ctx.seeds.managed.candidateId);
        assert.equal(managed.status, "final_shortlisted");
        assert.equal(managed.decidedBy, ctx.user.id);
        assert.equal((await getCandidate(ctx.seeds.thin.candidateId)).status, "interview_completed");
        return `applied ${result.applied.length} (${managed.status}, decided by the recruiter) · left for review ${result.needsReview} · failed ${result.failed}`;
      },
    },
    {
      id: "S6-21",
      title: "Clean-up: deleting the throw-away recruiter removes every row and file this stage created",
      requirement: "A demo run must leave the database as it found it.",
      input: "delete the user; count jobs, candidates, interviews, questions, answers, transcript turns, notifications and stored files",
      expect: "all counts 0, storage folder gone",
      run: async (ctx) => {
        const interviewIds = (await db.select({ id: interviews.id }).from(interviews).where(eq(interviews.userId, ctx.user.id))).map((r) => r.id);
        const before = interviewIds.length;
        await db.delete(users).where(eq(users.id, ctx.user.id));
        ctx.cleaned = true;
        const count = async (table, where) => (await db.select({ n: sql`count(*)::int` }).from(table).where(where))[0].n;
        const left = {
          jobs: await count(jobs, eq(jobs.userId, ctx.user.id)),
          candidates: await count(candidates, eq(candidates.userId, ctx.user.id)),
          interviews: await count(interviews, eq(interviews.userId, ctx.user.id)),
          questions: await count(interviewQuestions, eq(interviewQuestions.userId, ctx.user.id)),
          notifications: await count(notifications, eq(notifications.userId, ctx.user.id)),
          answers: interviewIds.length ? await count(interviewResponses, inArray(interviewResponses.interviewId, interviewIds)) : 0,
          turns: interviewIds.length ? await count(interviewTurns, inArray(interviewTurns.interviewId, interviewIds)) : 0,
        };
        assert.ok(Object.values(left).every((n) => n === 0), JSON.stringify(left));
        fs.rmSync(ctx.storageDir, { recursive: true, force: true });
        assert.equal(fs.existsSync(ctx.storageDir), false);
        return `${before} interviews deleted with the user · rows left: ${Object.entries(left).map(([k, v]) => `${k} ${v}`).join(", ")} · storage folder removed`;
      },
    },
  ],
};
