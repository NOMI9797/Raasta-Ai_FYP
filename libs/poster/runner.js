// The posting engine's brain: walks a platform's post form (a "flow", libs/poster/flow-*.js) in a browser window, fills each
// step in like a person, reads every field back, and hands over to the recruiter whenever a person is needed:
//   - a verification check or a sign-in (the window comes to the front and the run waits; nothing is clicked for them)
//   - a field that could not be filled in and read back, or a page that would not move on
//   - the platform's final button, which is always the recruiter's: the engine never presses it
// It reports through a "reporter" (the database in the engine, memory in tests), so the Publish panel can show the run live.
// Relative imports only (also used by the engine process).
import { FIELD_STATE, GATE, RUN_MODE, RUN_STATUS, STEP_STATUS, describeUnverified, fieldTotals, kitValues } from "./run-model";
import { isVisible, pathOf, visibleProblem, waitForPathChange } from "./page-tools";

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const firstLine = (text) => String(text || "").split("\n")[0].trim().slice(0, 300);
const iso = () => new Date().toISOString();

export const DEFAULT_TIMING = Object.freeze({
  gateWaitMs: 10 * 60 * 1000, // how long the window waits for a person before the run stops
  pollMs: 1000,
  recheckMs: 1200, // a check must still be there this long after it was first seen (pages flicker while they load)
  blockedWaitMs: 45 * 1000, // a block page with nothing on it to complete: waited on this long, then the run ends
  settleMs: 1500, // a page that has just opened may still be redirecting (a signed-out page becomes the sign-in page): wait before touching it
  continueWaitMs: 10 * 1000,
  maxLoops: 80,
});

/**
 * The reporter a run writes to. Everything is synchronous bookkeeping except shot() and cancelled().
 *   status(s) gate(g|null) step(id, patch) steps() heartbeat() log(text)
 *   shot(page, stepId) -> file name | null        cancelled() -> boolean
 * This one keeps everything in memory (tests, and dry runs without a database).
 */
export function createMemoryReporter({ cancelAfter = null } = {}) {
  const state = { status: RUN_STATUS.QUEUED, gate: null, steps: [], logs: [], shots: [], cancel: false };
  let cancelCalls = 0;
  return {
    state,
    status: (status) => { state.status = status; },
    gate: (gate) => { state.gate = gate; },
    step: (id, patch) => {
      const index = state.steps.findIndex((s) => s.id === id);
      if (index === -1) state.steps.push({ id, label: id, status: STEP_STATUS.PENDING, fields: [], shot: null, ...patch });
      else state.steps[index] = { ...state.steps[index], ...patch };
    },
    steps: () => state.steps,
    heartbeat: () => {},
    log: (text) => { state.logs.push(text); },
    shot: async (page, stepId) => { state.shots.push(stepId); return `${String(state.shots.length).padStart(2, "0")}-${stepId}.jpg`; },
    cancelled: async () => {
      cancelCalls += 1;
      return state.cancel || (cancelAfter !== null && cancelCalls > cancelAfter);
    },
  };
}

/**
 * Run one posting. Returns { status, outcome } where status is one of RUN_STATUS (published | rehearsed | failed |
 * cancelled) and outcome is { message, code?, postUrl?, verification? }.
 */
export async function runPosting({ page, flow, kit, mode = RUN_MODE.REHEARSAL, options = {}, reporter, human, sleep = realSleep, timing = {} }) {
  const t = { ...DEFAULT_TIMING, ...timing };
  const ctx = { page, human, values: kitValues(kit), options: { ...flow.defaults, ...(kit?.options || {}), ...options }, sleep };
  let confirmed = false; // the person pressed the platform's final button

  const finish = (status, outcome) => ({ status, outcome });
  const confirmLabel = flow.confirmLabel || "Confirm"; // the platform's own final button
  const stoppedMessage = (lead) => `${lead} ${confirmed ? `You had already pressed ${confirmLabel}, so check your ${flow.label} jobs list: the job may be there.` : "Nothing was posted."}`;

  async function stopReason() {
    if (await reporter.cancelled()) return finish(RUN_STATUS.CANCELLED, { code: "cancelled", message: stoppedMessage("The run was stopped.") });
    if (page.isClosed()) return finish(RUN_STATUS.CANCELLED, { code: "window_closed", message: stoppedMessage("The window was closed before the run finished.") });
    return null;
  }

  /**
   * Put a person in charge of the window until `isCleared()` has been true for `stable` polls in a row.
   * Returns null once cleared, or a finished result when the run ends instead (stopped, window closed, nobody came).
   */
  async function holdForPerson(gate, isCleared, { stable = 2, timeoutMs = t.gateWaitMs, onTimeout = null } = {}) {
    reporter.gate({ ...gate, since: iso() });
    reporter.status(gate.kind === GATE.CONFIRM ? RUN_STATUS.AWAITING_CONFIRM : RUN_STATUS.NEEDS_YOU);
    await page.bringToFront().catch(() => {});
    const deadline = Date.now() + timeoutMs;
    let clear = 0;
    for (;;) {
      const stop = await stopReason();
      if (stop) return stop;
      if (Date.now() > deadline) {
        if (onTimeout) return onTimeout();
        return finish(RUN_STATUS.FAILED, { code: "timed_out", message: `Nobody came back to the window within ${Math.max(1, Math.round(t.gateWaitMs / 60000))} minutes, so the run stopped. ${confirmed ? "" : "Nothing was posted."}`.trim() });
      }
      await sleep(t.pollMs);
      reporter.heartbeat();
      let cleared = false;
      try {
        cleared = await isCleared();
      } catch {
        cleared = false;
      }
      clear = cleared ? clear + 1 : 0;
      if (clear >= stable) {
        reporter.gate(null);
        reporter.status(RUN_STATUS.RUNNING);
        return null;
      }
    }
  }

  const moved = (from) => async () => pathOf(page.url()) !== from;

  async function confirmedBlocker() {
    const first = await flow.blocker(page);
    if (!first) return null;
    await sleep(t.recheckMs);
    return flow.blocker(page);
  }

  async function handleConfirm(step, fields, from) {
    const open = fields.filter((f) => f.state === FIELD_STATE.UNVERIFIED);
    const totals = fieldTotals(reporter.steps());
    const summary = `${totals.verified} of ${totals.checked} fields were read back from ${flow.label} and match your post${totals.open ? `; ${totals.open} need a look (${describeUnverified(open)})` : ""}.`;
    if (mode === RUN_MODE.REHEARSAL) {
      reporter.step(step.id, { status: STEP_STATUS.DONE, finishedAt: iso() });
      return finish(RUN_STATUS.REHEARSED, { message: `Rehearsal finished: ${summary} Nothing was submitted.`, verification: totals });
    }
    reporter.step(step.id, { status: STEP_STATUS.NEEDS_YOU });
    const lead = open.length
      ? `${open.length} item${open.length === 1 ? "" : "s"} on the review page differ from your post (${describeUnverified(open)}). Check ${open.length === 1 ? "it" : "them"} before you ${confirmLabel === "Confirm" ? "confirm" : "publish"}.`
      : "Everything on the review page matches your post.";
    const stop = await holdForPerson(
      { kind: GATE.CONFIRM, message: `${lead} Review the job in the window and press ${confirmLabel} yourself${flow.confirmNote ? ` (${flow.confirmNote})` : ""}; Raasta-AI never presses it.` },
      // Indeed moves to another page when its Confirm is pressed; Rozee.pk stays on the job page and the draft turns into a live job
      flow.confirmCleared ? () => flow.confirmCleared(page) : moved(from),
      { stable: 1 },
    );
    if (stop) return stop;
    confirmed = flow.confirmCleared ? true : Boolean(flow.afterConfirm?.includes(flow.matchStep(page.url())?.id));
    reporter.step(step.id, { status: STEP_STATUS.DONE, finishedAt: iso() });
    // A flow with nothing after the final button says how the run ends
    if (flow.finish) {
      const outcome = await flow.finish(page);
      return finish(RUN_STATUS.PUBLISHED, { ...outcome, verification: fieldTotals(reporter.steps()) });
    }
    return null;
  }

  async function handleStep(step) {
    const from = pathOf(page.url());
    reporter.step(step.id, { label: step.label, status: STEP_STATUS.RUNNING, startedAt: iso(), fields: [] });
    await human.glance(page);
    await human.think();

    let result;
    try {
      result = await step.run(ctx);
    } catch (error) {
      if (page.isClosed() || (await reporter.cancelled())) {
        return (await stopReason()) || finish(RUN_STATUS.CANCELLED, { code: "cancelled", message: stoppedMessage("The run was stopped.") });
      }
      reporter.log(`${step.id}: ${firstLine(error.message)}`);
      result = { fields: [{ key: step.id, label: step.label, state: FIELD_STATE.UNVERIFIED, note: "Raasta-AI could not fill this step in" }], advance: "continue" };
    }

    const fields = result.fields || [];
    reporter.step(step.id, { fields, shot: await reporter.shot(page, step.id) });
    const open = fields.filter((f) => f.state === FIELD_STATE.UNVERIFIED);

    if (result.advance === "done") {
      reporter.step(step.id, { status: STEP_STATUS.DONE, finishedAt: iso() });
      return finish(RUN_STATUS.PUBLISHED, { ...result.outcome, verification: fieldTotals(reporter.steps()) });
    }
    if (result.advance === "confirm") return handleConfirm(step, fields, from);

    if (open.length) {
      reporter.step(step.id, { status: STEP_STATUS.NEEDS_YOU });
      const stop = await holdForPerson(
        { kind: result.gateKind || GATE.FIELD, message: `${describeUnverified(open)}. Finish it in the window and press Continue; Raasta-AI carries on from the next page.` },
        moved(from),
        { stable: 1 },
      );
      if (stop) return stop;
    } else if (result.advance === "continue") {
      const next = flow.continueButton(page);
      if (!(await isVisible(next))) {
        reporter.step(step.id, { status: STEP_STATUS.NEEDS_YOU });
        const stop = await holdForPerson({ kind: GATE.FIELD, message: "The Continue button was not found. Press it yourself in the window." }, moved(from), { stable: 1 });
        if (stop) return stop;
      } else {
        await human.pause(300, 900); // a look over what was typed before moving on
        await human.click(page, next);
        if (!(await waitForPathChange(page, from, { timeoutMs: t.continueWaitMs, sleep }))) {
          // The platform did not move on: a question about the title, an answer it wants
          const problem = await visibleProblem(page);
          reporter.step(step.id, { status: STEP_STATUS.NEEDS_YOU });
          const stop = await holdForPerson(
            { kind: GATE.FIELD, message: `${flow.label} did not move on${problem ? `: "${problem.text}"` : ""}. Sort it out in the window and press Continue.` },
            moved(from),
            { stable: 1 },
          );
          if (stop) return stop;
        }
      }
    } else if (pathOf(page.url()) === from && !(await waitForPathChange(page, from, { timeoutMs: step.waitMs || t.continueWaitMs, sleep }))) {
      // advance "auto": the step did its own clicking and the page has not changed
      reporter.step(step.id, { status: STEP_STATUS.NEEDS_YOU });
      const stop = await holdForPerson({ kind: GATE.FIELD, message: `${flow.label} did not move on from "${step.label}". Carry on in the window.` }, moved(from), { stable: 1 });
      if (stop) return stop;
    }
    reporter.step(step.id, { status: STEP_STATUS.DONE, finishedAt: iso() });
    return null;
  }

  try {
    reporter.status(RUN_STATUS.RUNNING);
    await page.goto(flow.startUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    const handled = new Map(); // step id -> how many times it was filled in
    let startedOver = false;

    for (let loop = 0; loop < t.maxLoops; loop += 1) {
      const stop = await stopReason();
      if (stop) return stop;

      const blocker = await confirmedBlocker();
      if (blocker) {
        // An account the platform has paused cannot be posted to, and waiting would not change that
        if (blocker.fatal) return finish(RUN_STATUS.FAILED, { code: blocker.code || "blocked", message: blocker.message });
        const held = await holdForPerson(blocker, async () => !(await flow.blocker(page)), blocker.blocked
          ? { timeoutMs: t.blockedWaitMs, onTimeout: () => finish(RUN_STATUS.FAILED, { code: "blocked", message: blocker.message }) }
          : {});
        if (held) return held;
        continue;
      }

      const step = flow.matchStep(page.url());
      if (!step) {
        if (!startedOver) {
          startedOver = true;
          await page.goto(flow.startUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
          continue;
        }
        const held = await holdForPerson(
          { kind: GATE.PAGE, message: `Raasta-AI does not recognise this page (${pathOf(page.url()) || "blank"}). Go to ${flow.label}'s Post a job form in the window and it carries on from there.` },
          async () => Boolean(flow.matchStep(page.url())),
        );
        if (held) return held;
        continue;
      }

      const times = handled.get(step.id) || 0;
      if (times > 0 && !step.readOnly) {
        // Back on a step that was already filled in: the person is editing it, so nothing is typed over their changes
        const from = pathOf(page.url());
        reporter.step(step.id, { status: STEP_STATUS.NEEDS_YOU });
        const held = await holdForPerson(
          { kind: GATE.FIELD, message: `You are back on "${step.label}". Make your change and press Continue; Raasta-AI will not type over it.` },
          moved(from),
          { stable: 1 },
        );
        if (held) return held;
        reporter.step(step.id, { status: STEP_STATUS.DONE, finishedAt: iso() });
        continue;
      }
      const arrival = page.url();
      await sleep(t.settleMs);
      if (page.url() !== arrival || (await flow.blocker(page))) continue; // it moved on while it settled: look again
      handled.set(step.id, times + 1);
      const ended = await handleStep(step);
      if (ended) return ended;
    }
    return finish(RUN_STATUS.FAILED, { code: "too_many_steps", message: `The run went round in circles on ${flow.label} and stopped. ${confirmed ? "" : "Nothing was posted."}`.trim() });
  } catch (error) {
    if (page.isClosed()) return finish(RUN_STATUS.CANCELLED, { code: "window_closed", message: stoppedMessage("The window was closed before the run finished.") });
    return finish(RUN_STATUS.FAILED, { code: "error", message: `${firstLine(error.message) || "The run failed"}. ${confirmed ? "" : "Nothing was posted."}`.trim() });
  }
}
