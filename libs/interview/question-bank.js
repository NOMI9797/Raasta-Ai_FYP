// Interview question bank storage (docs/ai-hiring/07-question-bank.md).
// Relative imports only — runs in the worker and API routes.
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { candidates, interviewQuestions, interviews, jobs } from "../schema";
import { getRedisClient } from "../redis";
import { getHiringConfig } from "../hiring/config";
import { CATEGORIES, DIFFICULTIES, generateJobQuestions, generatePersonalisedQuestions } from "./question-generator";

const LOCK_MS = 60 * 1000;

export class QuestionBankError extends Error {
  constructor(message, { status = 400 } = {}) {
    super(message);
    this.name = "QuestionBankError";
    this.status = status;
  }
}

// ─── Locking: one generation per job at a time (lock:questions:{jobId}) ───

/**
 * Returns a release function, or null if another generation holds the lock.
 * If Redis is unreachable the generation proceeds unlocked rather than failing.
 */
export async function acquireQuestionLock(jobId, { redis = getRedisClient(), owner = `${process.pid}-${Date.now()}` } = {}) {
  const key = `lock:questions:${jobId}`;
  try {
    const ok = await redis.set(key, owner, "PX", LOCK_MS, "NX");
    if (!ok) return null;
  } catch (error) {
    console.warn("Question lock unavailable, continuing without it:", error?.message);
    return async () => {};
  }
  return async () => {
    try {
      if ((await redis.get(key)) === owner) await redis.del(key);
    } catch {
      // the lock expires on its own
    }
  };
}

// ─── Reads ───

const jobWide = (jobId) => and(eq(interviewQuestions.jobId, jobId), isNull(interviewQuestions.candidateId));

/**
 * Job-wide questions in order; with candidateId, that candidate's personalised ones too.
 */
export async function listQuestions(jobId, { candidateId = null, database = db } = {}) {
  const rows = await database
    .select()
    .from(interviewQuestions)
    .where(candidateId
      ? and(eq(interviewQuestions.jobId, jobId), sql`(${interviewQuestions.candidateId} is null or ${interviewQuestions.candidateId} = ${candidateId})`)
      : jobWide(jobId))
    .orderBy(asc(interviewQuestions.orderIndex), asc(interviewQuestions.createdAt));
  return rows;
}

async function activeJobWide(jobId, database) {
  return database
    .select()
    .from(interviewQuestions)
    .where(and(jobWide(jobId), eq(interviewQuestions.isActive, true)))
    .orderBy(asc(interviewQuestions.orderIndex));
}

// ─── Generation ───

/**
 * Generate AI questions for a job. mode "append" adds after the current bank; "replace"
 * deactivates the job's AI questions (manual ones are kept, after the new block).
 * Returns the inserted rows.
 */
export async function generateAndStore(jobId, { mode = "append", count, database = db, generator = generateJobQuestions } = {}) {
  if (!["append", "replace"].includes(mode)) throw new QuestionBankError('mode must be "append" or "replace"');

  const [job] = await database.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new QuestionBankError("Job not found", { status: 404 });
  const total = count ?? getHiringConfig(job).questionCount;
  if (!Number.isInteger(total) || total < 1 || total > 15) {
    throw new QuestionBankError("count must be a whole number between 1 and 15");
  }

  const active = await activeJobWide(jobId, database);
  const kept = mode === "replace" ? active.filter((q) => q.source === "manual") : active;
  const generated = await generator({ job, count: total, existing: kept.map((q) => q.question) });

  return database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`questions:${jobId}`}))`);
    let start = 0;
    if (mode === "replace") {
      await tx.update(interviewQuestions)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(jobWide(jobId), eq(interviewQuestions.source, "ai"), eq(interviewQuestions.isActive, true)));
      // Manual questions move after the new AI block, keeping their relative order
      for (const [i, q] of kept.entries()) {
        await tx.update(interviewQuestions)
          .set({ orderIndex: generated.length + i, updatedAt: new Date() })
          .where(eq(interviewQuestions.id, q.id));
      }
    } else {
      const [{ max }] = await tx
        .select({ max: sql`coalesce(max(${interviewQuestions.orderIndex}), -1)::int` })
        .from(interviewQuestions)
        .where(jobWide(jobId));
      start = max + 1;
    }
    if (!generated.length) return [];
    return tx.insert(interviewQuestions).values(generated.map((q, i) => ({
      userId: job.userId,
      jobId,
      candidateId: null,
      question: q.question,
      category: q.category,
      difficulty: q.difficulty,
      idealAnswer: q.idealAnswer,
      expectedKeywords: q.expectedKeywords,
      scoreWeight: q.scoreWeight,
      orderIndex: start + i,
      source: "ai",
      isActive: true,
    }))).returning();
  });
}

/**
 * Worker job ensure-questions: create the bank only if the job has no active job-wide questions.
 */
export async function ensureJobQuestions(jobId, { database = db, generator } = {}) {
  const active = await activeJobWide(jobId, database);
  if (active.length) return { jobId, skipped: "questions exist", active: active.length };
  const inserted = await generateAndStore(jobId, { mode: "append", database, generator });
  return { jobId, created: inserted.length };
}

/**
 * Worker job personalise-questions: add hiringConfig.personalisedQuestions questions for one
 * candidate, built from their screening gaps. Skips if disabled or already personalised.
 */
export async function personaliseCandidate(candidateId, { database = db, generator = generatePersonalisedQuestions } = {}) {
  const [candidate] = await database.select().from(candidates).where(eq(candidates.id, candidateId)).limit(1);
  if (!candidate) return { candidateId, skipped: "candidate not found" };
  const [job] = await database.select().from(jobs).where(eq(jobs.id, candidate.jobId)).limit(1);
  if (!job) return { candidateId, skipped: "job not found" };

  const count = getHiringConfig(job).personalisedQuestions;
  if (!count) return { candidateId, skipped: "personalised questions disabled" };

  const [{ n }] = await database
    .select({ n: sql`count(*)::int` })
    .from(interviewQuestions)
    .where(and(eq(interviewQuestions.candidateId, candidateId), eq(interviewQuestions.isActive, true)));
  if (n > 0) return { candidateId, skipped: "already personalised" };

  const existing = (await activeJobWide(job.id, database)).map((q) => q.question);
  const generated = await generator({ job, candidate, count, existing });
  if (!generated.length) return { candidateId, skipped: "no screening gaps to probe" };

  await database.insert(interviewQuestions).values(generated.map((q, i) => ({
    userId: job.userId,
    jobId: job.id,
    candidateId,
    question: q.question,
    category: q.category,
    difficulty: q.difficulty,
    idealAnswer: q.idealAnswer,
    expectedKeywords: q.expectedKeywords,
    scoreWeight: q.scoreWeight,
    orderIndex: i,
    source: "ai",
    isActive: true,
  })));
  return { candidateId, created: generated.length };
}

// ─── Manual edits ───

/**
 * Validate a manual question (create) or a partial edit (update).
 * Returns { value, errors }. The ideal answer may be empty (the UI warns about it).
 */
export function validateQuestionInput(input, { partial = false } = {}) {
  const errors = [];
  const value = {};
  const has = (key) => input?.[key] !== undefined;
  if (!input || typeof input !== "object") return { value, errors: ["Body must be an object"] };

  if (!partial || has("question")) {
    const question = typeof input.question === "string" ? input.question.trim() : "";
    if (!question) errors.push("question is required");
    else if (question.length > 500) errors.push("question must be 500 characters or fewer");
    value.question = question;
  }
  if (!partial || has("category")) {
    const category = input.category ?? "technical";
    if (!CATEGORIES.includes(category)) errors.push(`category must be one of ${CATEGORIES.join(", ")}`);
    value.category = category;
  }
  if (!partial || has("difficulty")) {
    const difficulty = input.difficulty ?? "medium";
    if (!DIFFICULTIES.includes(difficulty)) errors.push(`difficulty must be one of ${DIFFICULTIES.join(", ")}`);
    value.difficulty = difficulty;
  }
  if (!partial || has("idealAnswer")) {
    if (input.idealAnswer != null && typeof input.idealAnswer !== "string") errors.push("idealAnswer must be text");
    value.idealAnswer = typeof input.idealAnswer === "string" ? input.idealAnswer.trim().slice(0, 4000) : "";
  }
  if (!partial || has("expectedKeywords")) {
    const raw = input.expectedKeywords ?? [];
    if (!Array.isArray(raw) || raw.some((k) => typeof k !== "string")) errors.push("expectedKeywords must be a list of text");
    else value.expectedKeywords = [...new Set(raw.map((k) => k.trim()).filter(Boolean))].slice(0, 15);
  }
  if (!partial || has("scoreWeight")) {
    const weight = input.scoreWeight ?? 1;
    if (!Number.isInteger(weight) || weight < 1 || weight > 5) errors.push("scoreWeight must be a whole number from 1 to 5");
    value.scoreWeight = weight;
  }
  if (partial && has("isActive")) {
    if (typeof input.isActive !== "boolean") errors.push("isActive must be true or false");
    value.isActive = input.isActive;
  }
  if (partial && has("orderIndex")) {
    if (!Number.isInteger(input.orderIndex) || input.orderIndex < 0) errors.push("orderIndex must be a whole number of 0 or more");
    value.orderIndex = input.orderIndex;
  }
  return { value, errors };
}

export async function addManualQuestion(job, input, { database = db } = {}) {
  const { value, errors } = validateQuestionInput(input);
  if (errors.length) throw Object.assign(new QuestionBankError("Invalid question"), { details: errors });
  const [{ max }] = await database
    .select({ max: sql`coalesce(max(${interviewQuestions.orderIndex}), -1)::int` })
    .from(interviewQuestions)
    .where(jobWide(job.id));
  const [row] = await database.insert(interviewQuestions).values({
    ...value,
    userId: job.userId,
    jobId: job.id,
    candidateId: null,
    orderIndex: max + 1,
    source: "manual",
    isActive: true,
  }).returning();
  return row;
}

/**
 * Set the order of a job's job-wide questions. `ids` must belong to the job; questions not
 * listed keep their relative order after the listed ones.
 */
export async function reorderQuestions(jobId, ids, { database = db } = {}) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string") || new Set(ids).size !== ids.length) {
    throw new QuestionBankError("ids must be a list of unique question ids");
  }
  return database.transaction(async (tx) => {
    const rows = await tx
      .select({ id: interviewQuestions.id })
      .from(interviewQuestions)
      .where(jobWide(jobId))
      .orderBy(asc(interviewQuestions.orderIndex), asc(interviewQuestions.createdAt));
    const known = new Set(rows.map((r) => r.id));
    if (ids.some((id) => !known.has(id))) throw new QuestionBankError("ids contain questions from another job");
    const listed = new Set(ids);
    const order = [...ids, ...rows.map((r) => r.id).filter((id) => !listed.has(id))];
    for (const [i, id] of order.entries()) {
      await tx.update(interviewQuestions).set({ orderIndex: i, updatedAt: new Date() }).where(eq(interviewQuestions.id, id));
    }
    return order;
  });
}

/**
 * Delete a question: soft (isActive=false) if any interview snapshot includes it, hard otherwise.
 */
export async function deleteQuestion(question, { database = db } = {}) {
  const [used] = await database
    .select({ id: interviews.id })
    .from(interviews)
    .where(and(
      eq(interviews.jobId, question.jobId),
      sql`position(${question.id} in coalesce(${interviews.questionSnapshot}::text, '')) > 0`,
    ))
    .limit(1);
  if (used) {
    await database.update(interviewQuestions)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(interviewQuestions.id, question.id));
    return { deleted: "soft" };
  }
  await database.delete(interviewQuestions).where(eq(interviewQuestions.id, question.id));
  return { deleted: "hard" };
}
