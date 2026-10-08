// What a posting run is, in plain data: its statuses, the reasons it needs a person, the timeline of steps, and the
// view of it that is safe to send to the browser. No database and no browser in here, so it is tested on its own.
// Relative imports only (also used by the engine process).

// The platforms that have a flow for the engine (libs/poster/flow-*.js)
export const ENGINE_PLATFORMS = Object.freeze(["indeed", "rozee"]);

export const RUN_MODE = Object.freeze({
  REHEARSAL: "rehearsal", // fills in every step, checks what is on the form, and stops before the final confirm; nothing is posted
  POST: "post", // the same, then waits for the recruiter to press the platform's own final button
  PRACTICE: "practice", // the whole run, Confirm included, on a practice site that stands in for the platform: no account, no network, nothing recorded
});

export const RUN_STATUS = Object.freeze({
  QUEUED: "queued", // waiting for the posting engine to pick it up
  RUNNING: "running",
  NEEDS_YOU: "needs_you", // the window is waiting for the person (see the gate)
  AWAITING_CONFIRM: "awaiting_confirm", // everything is filled in and checked; the person presses the platform's final button
  PUBLISHED: "published",
  REHEARSED: "rehearsed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

export const LIVE_STATUSES = Object.freeze([RUN_STATUS.QUEUED, RUN_STATUS.RUNNING, RUN_STATUS.NEEDS_YOU, RUN_STATUS.AWAITING_CONFIRM]);
export const isLive = (status) => LIVE_STATUSES.includes(status);

// Why the window is waiting for a person
export const GATE = Object.freeze({
  CHECK: "check", // the platform's bot or verification check
  SIGN_IN: "sign_in", // the platform asks for a sign-in
  FIELD: "field", // something could not be filled in or checked, or the platform did not move on
  PAGE: "page", // a page the engine does not know
  CONFIRM: "confirm", // the final button, which is always the person's
  SPONSOR: "sponsor", // a paid plan is offered; the engine never chooses one
  ACCOUNT: "account", // the platform has paused or restricted the account: nothing can be posted, and the run ends
});

export const STEP_STATUS = Object.freeze({ PENDING: "pending", RUNNING: "running", DONE: "done", NEEDS_YOU: "needs_you", FAILED: "failed" });
export const FIELD_STATE = Object.freeze({
  VERIFIED: "verified", // typed or chosen, then read back from the page and found to match
  UNVERIFIED: "unverified", // could not be set or did not read back the same: the person finishes it
  SKIPPED: "skipped", // nothing to enter (the job has no value for it) or left to the person on purpose
});

// A run that reports nothing for this long while it should be working has lost its engine
export const HEARTBEAT_STALE_MS = 60 * 1000;
// A queued run nobody picks up is dropped after this long
export const QUEUE_EXPIRY_MS = 30 * 60 * 1000;
// After this long queued, the panel says the engine does not seem to be running
export const ENGINE_SLOW_MS = 8 * 1000;

export class RunError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = "RunError";
    this.code = code;
    this.status = status;
  }
}

/** key -> value for the fields of a posting kit (libs/hiring/posting-kit.js). */
export function kitValues(kit) {
  const values = {};
  for (const item of kit?.fields || []) values[item.key] = String(item.value ?? "");
  return values;
}

/** The timeline as it starts: every step the flow has, none begun. */
export function initialSteps(flow) {
  return flow.steps.map((step) => ({ id: step.id, label: step.label, status: STEP_STATUS.PENDING, fields: [], shot: null, startedAt: null, finishedAt: null }));
}

/** A copy of the timeline with `patch` merged into the step `id` (a step that is not there yet is added). */
export function upsertStep(steps, id, patch) {
  const list = Array.isArray(steps) ? steps : [];
  if (!list.some((step) => step.id === id)) return [...list, { id, label: patch.label || id, status: STEP_STATUS.PENDING, fields: [], shot: null, startedAt: null, finishedAt: null, ...patch }];
  return list.map((step) => (step.id === id ? { ...step, ...patch } : step));
}

/** One line a person can read for a field the engine could not verify. */
export function describeUnverified(fields) {
  const open = (fields || []).filter((f) => f.state === FIELD_STATE.UNVERIFIED);
  if (open.length === 0) return "";
  return open.map((f) => (f.note ? `${f.label}: ${f.note}` : f.label)).join("; ");
}

const SHOT = /^[a-z0-9][a-z0-9-]{0,60}\.jpg$/;
/** A screenshot name that is safe to turn into a file path. */
export const isShotName = (name) => SHOT.test(String(name || ""));

/**
 * The run as the Publish panel sees it. The kit (the job's own text) and the engine's identity stay on the server.
 * `stale` means the engine stopped reporting while the run was live; `waitingForEngine` means it has not been picked up.
 */
export function publicRun(row, now = new Date()) {
  const t = now.getTime();
  const age = (value) => (value ? t - new Date(value).getTime() : 0);
  const live = isLive(row.status);
  const working = [RUN_STATUS.RUNNING, RUN_STATUS.NEEDS_YOU, RUN_STATUS.AWAITING_CONFIRM].includes(row.status);
  return {
    id: row.id,
    jobId: row.jobId,
    platform: row.platform,
    mode: row.mode,
    status: row.status,
    live,
    gate: row.gate || null,
    steps: Array.isArray(row.steps) ? row.steps : [],
    outcome: row.outcome || null,
    cancelRequested: Boolean(row.cancelRequested),
    waitingForEngine: row.status === RUN_STATUS.QUEUED && age(row.createdAt) > ENGINE_SLOW_MS,
    stale: working && row.heartbeatAt ? age(row.heartbeatAt) > HEARTBEAT_STALE_MS : false,
    createdAt: row.createdAt,
    startedAt: row.startedAt || null,
    completedAt: row.completedAt || null,
  };
}

/**
 * How many of the fields a run checked were found right, for the one-line summary:
 * { checked, verified, open }. `steps` is the timeline.
 */
export function fieldTotals(steps) {
  const fields = (steps || []).flatMap((step) => step.fields || []);
  const checked = fields.filter((f) => f.state !== FIELD_STATE.SKIPPED);
  return { checked: checked.length, verified: checked.filter((f) => f.state === FIELD_STATE.VERIFIED).length, open: checked.filter((f) => f.state === FIELD_STATE.UNVERIFIED).length };
}
