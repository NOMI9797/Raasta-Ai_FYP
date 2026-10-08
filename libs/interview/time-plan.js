// How long an interview lasts decides how it runs (docs/ai-hiring/09-interview-engine.md, "Time budget").
// The recruiter sets the length per job (hiring_config.interviewMaxMinutes); everything else follows from it:
// how many questions are asked, how many follow-ups there is room for, when the candidate is warned and
// what the greeting promises. Pure functions only: the recruiter's settings screen uses them too, so what
// it promises is what the interviewer does.
// Relative imports only — runs in the interview engine and in the browser.

export const MIN_INTERVIEW_MINUTES = 5;
export const MAX_INTERVIEW_MINUTES = 120;
export const DEFAULT_INTERVIEW_MINUTES = 25;
export const INTERVIEW_LENGTH_PRESETS = [10, 15, 20, 30, 45, 60];

const MINUTE = 60 * 1000;

// Greeting, goodbye and slack that no question gets to use
export const RESERVE_MS = 1 * MINUTE;
// One question with its answer and its share of follow-ups, on average. Sets how many questions fit
export const PLAN_QUESTION_MS = 2.5 * MINUTE;
// The least time a question that is still to come may need. A follow-up is only asked while every
// remaining question can still get this much, so follow-ups never crowd out planned questions
export const QUESTION_MIN_MS = 1.5 * MINUTE;
export const FOLLOW_UP_COST_MS = 75 * 1000;
export const CLOSE_RESERVE_MS = 20 * 1000;

export function clampMinutes(minutes) {
  const value = Math.round(Number(minutes));
  if (!Number.isFinite(value)) return DEFAULT_INTERVIEW_MINUTES;
  return Math.min(MAX_INTERVIEW_MINUTES, Math.max(MIN_INTERVIEW_MINUTES, value));
}

/** How many questions fit in `minutes`, at most `pool` (the number of questions available). */
export function questionsThatFit(minutes, pool) {
  const usable = clampMinutes(minutes) * MINUTE - RESERVE_MS;
  const fit = Math.max(1, Math.floor(usable / PLAN_QUESTION_MS));
  return Math.max(0, Math.min(fit, pool));
}

/**
 * Pick `count` of the questions when time does not allow all of them. Every topic (technical, role,
 * behavioural) is represented before any gets a second question; after that the heaviest-weighted
 * questions win. The picks keep the bank's order (warm-up first). With room for all, nothing is dropped.
 */
export function selectQuestions(questions, count) {
  if (count >= questions.length) return questions.slice();
  const weight = (item) => item.q.scoreWeight || 1;
  const byCategory = new Map();
  questions.forEach((q, index) => {
    const key = q.category || "technical";
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push({ q, index });
  });
  const lanes = [...byCategory.values()]
    .map((lane) => lane.sort((a, b) => weight(b) - weight(a) || a.index - b.index))
    // the topic holding the heaviest question goes first; ties keep the bank's order
    .sort((a, b) => weight(b[0]) - weight(a[0]) || a[0].index - b[0].index);

  const picked = lanes.slice(0, count).map((lane) => lane[0]);
  const rest = lanes.flatMap((lane) => lane.slice(1)).sort((a, b) => weight(b) - weight(a) || a.index - b.index);
  for (const item of rest) {
    if (picked.length >= count) break;
    picked.push(item);
  }
  return picked.sort((a, b) => a.index - b.index).map((p) => p.q);
}

/**
 * The plan for one interview.
 * @param {{ minutes: number, questions: Array<{id: string, category?: string, scoreWeight?: number}>, maxFollowUps?: number }} p
 * @returns {{ minutes: number, maxMs: number, poolSize: number, questionCount: number, questionIds: string[],
 *             trimmed: boolean, roomForMore: number, followUpsPerQuestion: number }}
 */
export function planInterview({ minutes, questions, maxFollowUps = 2 }) {
  const length = clampMinutes(minutes);
  const count = questionsThatFit(length, questions.length);
  const chosen = selectQuestions(questions, count);
  const fit = Math.max(1, Math.floor((length * MINUTE - RESERVE_MS) / PLAN_QUESTION_MS));
  return {
    minutes: length,
    maxMs: length * MINUTE,
    poolSize: questions.length,
    questionCount: chosen.length,
    questionIds: chosen.map((q) => q.id),
    trimmed: chosen.length < questions.length,
    // Questions the time would allow beyond the pool: that time goes to follow-ups instead
    roomForMore: Math.max(0, fit - questions.length),
    // Follow-ups the slack allows per question when every planned question takes the planning average
    followUpsPerQuestion: chosen.length
      ? Math.min(maxFollowUps, Math.max(0, Math.floor((length * MINUTE - RESERVE_MS - chosen.length * QUESTION_MIN_MS) / chosen.length / FOLLOW_UP_COST_MS)))
      : 0,
  };
}

/**
 * Is there time for one more follow-up? Only while every question still to come keeps its minimum
 * time and the goodbye still fits.
 */
export function followUpAffordable({ remainingMs, questionsLeft }) {
  return remainingMs - CLOSE_RESERVE_MS - Math.max(0, questionsLeft) * QUESTION_MIN_MS >= FOLLOW_UP_COST_MS;
}

/**
 * Minutes-left warnings for an interview of `minutes`: "5 minutes left" means nothing in a 5-minute
 * interview, so the first warning scales down with the length (a quarter of it, at most 5), and
 * the last is always 1 minute.
 */
export function warningThresholds(minutes) {
  const first = Math.min(5, Math.floor(clampMinutes(minutes) / 4));
  return first > 1 ? [first, 1] : [1];
}

/** "about 8 questions in up to 25 minutes" (what the greeting and the welcome screen say) */
export function describeLength({ minutes, questionCount }) {
  const questions = `${questionCount} question${questionCount === 1 ? "" : "s"}`;
  return `${questions} in up to ${minutes} minute${minutes === 1 ? "" : "s"}`;
}
