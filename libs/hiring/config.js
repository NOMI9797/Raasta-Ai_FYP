// Per-job hiring automation settings (docs/ai-hiring/05-data-model.md §1).
// Stored in jobs.hiring_config; anything missing falls back to these defaults.

export const DEFAULT_HIRING_CONFIG = {
  autoScreen: true,          // screen on apply
  minFitScore: 70,           // stage-1 threshold (0-100)
  maxShortlist: 20,          // top-N cap per job (null = no cap)
  autoInvite: true,          // email interview link on shortlist
  inviteExpiryHours: 72,
  reminderAfterHours: 24,
  questionCount: 8,          // base questions in the bank
  personalisedQuestions: 0,  // extra per-candidate questions (0-2)
  maxFollowUps: 2,
  interviewMaxMinutes: 25,
  resumeWindowMinutes: 15,   // reconnect window after disconnect
  recordVideo: true,
  trackBehavior: true,       // analyse eye contact, head movement and expressions from the camera (needs recordVideo)
  finalWeights: { resume: 0.3, interview: 0.5, communication: 0.2 },
  finalThreshold: 70,
  autoFinalize: false,       // false = recruiter approves final decisions
  sendOutcomeEmails: false,
};

export function getHiringConfig(job) {
  const c = { ...DEFAULT_HIRING_CONFIG, ...(job?.hiringConfig || {}) };
  c.finalWeights = { ...DEFAULT_HIRING_CONFIG.finalWeights, ...(job?.hiringConfig?.finalWeights || {}) };
  return c;
}

// Alias used in docs/ai-hiring/02-architecture.md
export const mergeHiringConfig = getHiringConfig;

const BOOLEAN_KEYS = ["autoScreen", "autoInvite", "recordVideo", "trackBehavior", "autoFinalize", "sendOutcomeEmails"];

// [key, min, max] — integers within an inclusive range
const INTEGER_RANGES = [
  ["minFitScore", 0, 100],
  ["finalThreshold", 0, 100],
  ["questionCount", 3, 15],
  ["interviewMaxMinutes", 5, 60],
  ["personalisedQuestions", 0, 2],
  ["maxFollowUps", 0, 5],
  ["inviteExpiryHours", 1, 24 * 30],
  ["reminderAfterHours", 0, 24 * 30],
  ["resumeWindowMinutes", 0, 120],
];

const WEIGHT_KEYS = Object.keys(DEFAULT_HIRING_CONFIG.finalWeights);

/**
 * Validate a (partial) hiring config from a recruiter.
 * Returns { config, errors }: config is the full normalised config to store,
 * errors lists every problem found (config should not be saved when non-empty).
 * Unknown keys are dropped.
 */
export function validateHiringConfig(input) {
  const errors = [];
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return { config: getHiringConfig(null), errors: ["hiringConfig must be an object"] };
  }

  const merged = getHiringConfig({ hiringConfig: input });
  const config = {};

  for (const key of BOOLEAN_KEYS) {
    if (typeof merged[key] !== "boolean") errors.push(`${key} must be true or false`);
    config[key] = Boolean(merged[key]);
  }

  for (const [key, min, max] of INTEGER_RANGES) {
    const value = merged[key];
    if (!Number.isInteger(value) || value < min || value > max) {
      errors.push(`${key} must be a whole number between ${min} and ${max}`);
    }
    config[key] = value;
  }

  if (merged.maxShortlist === null) {
    config.maxShortlist = null;
  } else {
    if (!Number.isInteger(merged.maxShortlist) || merged.maxShortlist < 1) {
      errors.push("maxShortlist must be a whole number of at least 1, or null for no cap");
    }
    config.maxShortlist = merged.maxShortlist;
  }

  const weights = {};
  let total = 0;
  for (const key of WEIGHT_KEYS) {
    const value = merged.finalWeights[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      errors.push(`finalWeights.${key} must be a number of 0 or more`);
      weights[key] = 0;
    } else {
      weights[key] = value;
      total += value;
    }
  }
  if (total <= 0) {
    errors.push("finalWeights must not all be zero");
    config.finalWeights = { ...DEFAULT_HIRING_CONFIG.finalWeights };
  } else {
    // Normalise so the weights sum to 1 (rounded to 4 decimals)
    config.finalWeights = Object.fromEntries(
      WEIGHT_KEYS.map((key) => [key, Math.round((weights[key] / total) * 10000) / 10000])
    );
  }

  return { config, errors };
}
