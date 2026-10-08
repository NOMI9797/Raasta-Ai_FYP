/**
 * Indeed debug recorder.
 *
 * Browser automation fails silently: a page changed, a check appeared, a button moved. This records what the
 * automation actually saw, step by step, so a failure can be read instead of guessed at:
 *   - a screenshot of the page
 *   - its structure: headings, buttons, links and form fields with the attributes a selector needs
 *   - console errors, page errors and failed network requests
 * Files go to debug-indeed/<run>/ (git-ignored), one run per folder, the newest 20 kept.
 *
 * What is never recorded: field values, cookies, local or session storage, and query strings of URLs.
 * Recording is best effort and must never break the thing being debugged: every failure is noted and swallowed.
 */
import fs from "node:fs";
import path from "node:path";
import { classifyIndeedUrl } from "./indeed-session-validator";
import { DESCRIBE_PAGE_SCRIPT } from "./indeed-page-script";

const KEEP_RUNS = 20;
const MAX_NOTES = 50;

export function debugEnabled(env = process.env) {
  return env.INDEED_DEBUG === "true";
}

export function debugRoot(env = process.env) {
  return path.resolve(env.INDEED_DEBUG_DIR || "debug-indeed");
}

const slug = (text) => String(text || "step").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "step";
const firstLine = (text) => String(text || "").split("\n")[0].slice(0, 300);
// Origin and path only. Challenge pages use paths hundreds of characters long, so cap them too
const withoutQuery = (url) => {
  let clean;
  try {
    const parsed = new URL(url);
    clean = parsed.origin + parsed.pathname;
  } catch {
    clean = String(url || "").split("?")[0];
  }
  return clean.length > 140 ? `${clean.slice(0, 139)}…` : clean;
};

/** Whether the requests a page made include Cloudflare's bot check (the page behind it never loaded). */
export function botCheckSeen(failedRequests = []) {
  return failedRequests.some((r) => /challenges\.cloudflare\.com|\/cdn-cgi\/challenge-platform/.test(r.url));
}

/** The most recent recorded runs, newest first: { runId, label, outcome, finishedAt, steps, location }. */
export async function listDebugRuns({ env = process.env, limit = 10 } = {}) {
  const root = debugRoot(env);
  let names = [];
  try {
    names = (await fs.promises.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse().slice(0, limit);
  } catch {
    return [];
  }
  const runs = [];
  for (const name of names) {
    try {
      const trace = JSON.parse(await fs.promises.readFile(path.join(root, name, "trace.json"), "utf8"));
      runs.push({
        runId: trace.runId,
        label: trace.label,
        outcome: trace.outcome?.outcome || (trace.outcome?.success ? "published" : trace.outcome?.code || null),
        message: trace.outcome?.message || trace.outcome?.error || null,
        finishedAt: trace.finishedAt,
        steps: trace.steps?.length || 0,
        location: path.relative(process.cwd(), path.join(root, name)),
      });
    } catch {
      runs.push({ runId: name, label: null, outcome: "unfinished", message: null, finishedAt: null, steps: 0, location: path.relative(process.cwd(), path.join(root, name)) });
    }
  }
  return runs;
}

export class DebugRecorder {
  constructor({ label = "run", env = process.env, root } = {}) {
    this.label = slug(label);
    this.startedAt = new Date();
    this.runId = `${this.startedAt.toISOString().replace(/[:.]/g, "-")}-${this.label}`;
    this.root = root || debugRoot(env);
    this.dir = path.join(this.root, this.runId);
    this.steps = [];
    this.console = [];
    this.pageErrors = [];
    this.failedRequests = [];
    this.ready = null;
  }

  async #prepare() {
    this.ready ||= (async () => {
      await fs.promises.mkdir(this.dir, { recursive: true });
      await this.#prune();
    })();
    return this.ready;
  }

  async #prune() {
    try {
      const runs = (await fs.promises.readdir(this.root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
      for (const old of runs.slice(0, Math.max(0, runs.length - KEEP_RUNS))) {
        await fs.promises.rm(path.join(this.root, old), { recursive: true, force: true });
      }
    } catch {
      /* pruning is housekeeping */
    }
  }

  /** Listen for console errors, page errors and failed requests on a page. Call once per page, early. */
  attach(page) {
    const push = (list, item) => { if (list.length < MAX_NOTES) list.push(item); };
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) push(this.console, { type: message.type(), text: firstLine(message.text()) });
    });
    page.on("pageerror", (error) => push(this.pageErrors, firstLine(error.message)));
    page.on("response", (response) => {
      if (response.status() >= 400) push(this.failedRequests, { status: response.status(), method: response.request().method(), url: withoutQuery(response.url()) });
    });
    page.on("requestfailed", (request) => push(this.failedRequests, { status: 0, method: request.method(), url: withoutQuery(request.url()), failure: firstLine(request.failure()?.errorText) }));
  }

  /**
   * Record the page as it is now. Returns the step (with `dataUri` when `inline` is set, for showing in the UI;
   * the data URI is not written to trace.json).
   */
  async snap(page, name, { note, inline = false } = {}) {
    const index = this.steps.length + 1;
    const base = `${String(index).padStart(2, "0")}-${slug(name)}`;
    const step = { index, name, at: new Date().toISOString(), note: note || null, url: null, title: null, kind: null };
    try {
      await this.#prepare();
      step.url = withoutQuery(page.url());
      step.kind = classifyIndeedUrl(page.url());
      step.title = await page.title().catch(() => null);
      const shot = await page.screenshot({ type: "jpeg", quality: 70, fullPage: false });
      await fs.promises.writeFile(path.join(this.dir, `${base}.jpg`), shot);
      step.screenshot = `${base}.jpg`;
      if (inline) step.dataUri = `data:image/jpeg;base64,${shot.toString("base64")}`;
      const structure = await page.evaluate(DESCRIBE_PAGE_SCRIPT);
      await fs.promises.writeFile(path.join(this.dir, `${base}.json`), JSON.stringify(structure, null, 2));
      step.structure = `${base}.json`;
      step.summary = { headings: structure.headings.length, buttons: structure.buttons.length, links: structure.links.length, fields: structure.fields.length, dialogs: structure.dialogs.length };
    } catch (error) {
      step.error = firstLine(error.message);
    }
    this.steps.push(step);
    return step;
  }

  /** A step with no page, e.g. "clicked Post a job" or "the entry was not found". */
  note(name, note) {
    const step = { index: this.steps.length + 1, name, at: new Date().toISOString(), note: String(note || "") };
    this.steps.push(step);
    return step;
  }

  /** Write trace.json. `outcome` is whatever summarises the run ({ success, code, error } for a publish). */
  async finish(outcome) {
    const trace = {
      runId: this.runId,
      label: this.label,
      startedAt: this.startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      outcome: outcome ?? null,
      steps: this.steps,
      console: this.console,
      pageErrors: this.pageErrors,
      failedRequests: this.failedRequests,
    };
    try {
      await this.#prepare();
      await fs.promises.writeFile(path.join(this.dir, "trace.json"), JSON.stringify(trace, (key, value) => (key === "dataUri" ? undefined : value), 2));
    } catch (error) {
      trace.writeError = firstLine(error.message);
    }
    return trace;
  }

  /** Where the files are, relative to the project when possible, for messages. */
  get location() {
    return path.relative(process.cwd(), this.dir) || this.dir;
  }
}
