// Small test runner for the hiring-pipeline demo (docs/ai-hiring/22-demo-test-cases.md).
// Each case states what it checks, the input, the expected result, and returns what it actually
// observed, so the output can be read aloud during a demo. No test framework: it prints as it goes.
import { performance } from "node:perf_hooks";

const colour = Boolean(process.env.FORCE_COLOR) || (Boolean(process.stdout.isTTY) && !process.env.NO_COLOR);
const wrap = (code) => (text) => (colour ? `\x1b[${code}m${text}\x1b[0m` : String(text));
export const paint = { green: wrap(32), red: wrap(31), yellow: wrap(33), cyan: wrap(36), dim: wrap(2), bold: wrap(1) };

const ICON = { pass: "PASS", fail: "FAIL", skip: "SKIP" };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Trim one line to the terminal width so the demo output does not wrap. */
function clip(text, indent = 0) {
  const width = (process.stdout.columns || 120) - indent - 1;
  const flat = String(text).replace(/\s+/g, " ").trim();
  return flat.length > width ? `${flat.slice(0, width - 1)}…` : flat;
}

/** Thrown by a case (or a stage's setup) that cannot run here, for example no database. Reported as SKIP. */
export class Skip extends Error {
  constructor(reason) {
    super(reason);
    this.name = "Skip";
  }
}

export class Runner {
  /** @param {{ detail?: 0|1|2, paceMs?: number }} options detail: 0 one line, 1 + expected/actual, 2 + requirement/input */
  constructor({ detail = 1, paceMs = 0 } = {}) {
    this.detail = detail;
    this.paceMs = paceMs;
    this.results = [];
    this.stages = [];
  }

  print(line = "") {
    process.stdout.write(`${line}\n`);
  }

  /**
   * Run one stage: { id, title, tier, intro, setup?, teardown?, cases }.
   * setup() returns the shared context passed to every case (or throws Skip to skip them all).
   */
  async runStage(stage) {
    const started = performance.now();
    const tierLabel = { offline: "offline: real code, fake LLM/email/queue", database: "real Postgres, throw-away data", live: "live: real LLM (Groq)" }[stage.tier] || stage.tier;
    this.print("");
    this.print(paint.bold(paint.cyan(`STAGE ${stage.id}  ${stage.title}`)) + paint.dim(`   [${tierLabel}]`));
    if (stage.intro) this.print(paint.dim(`  ${stage.intro}`));

    const record = { id: stage.id, title: stage.title, tier: stage.tier, pass: 0, fail: 0, skip: 0, ms: 0 };
    this.stages.push(record);

    let context = {};
    let setupSkip = null;
    try {
      if (stage.setup) context = (await stage.setup()) || {};
    } catch (error) {
      if (error instanceof Skip) setupSkip = error.message;
      else {
        // A broken set-up fails every case in the stage, loudly, instead of hiding them
        setupSkip = null;
        for (const testCase of stage.cases) this.record(record, stage, testCase, { status: "fail", error: new Error(`stage set-up failed: ${error.message}`), ms: 0 });
        record.ms = Math.round(performance.now() - started);
        return record;
      }
    }

    try {
      for (const testCase of stage.cases) {
        if (setupSkip) {
          this.record(record, stage, testCase, { status: "skip", reason: setupSkip, ms: 0 });
          continue;
        }
        const t0 = performance.now();
        try {
          const actual = await testCase.run(context);
          this.record(record, stage, testCase, { status: "pass", actual, ms: performance.now() - t0 });
        } catch (error) {
          if (error instanceof Skip) this.record(record, stage, testCase, { status: "skip", reason: error.message, ms: performance.now() - t0 });
          else this.record(record, stage, testCase, { status: "fail", error, ms: performance.now() - t0 });
        }
        if (this.paceMs) await sleep(this.paceMs);
      }
    } finally {
      if (stage.teardown) {
        try {
          await stage.teardown(context);
        } catch (error) {
          this.print(paint.yellow(`  (clean-up of stage ${stage.id} reported: ${error.message})`));
        }
      }
    }
    record.ms = Math.round(performance.now() - started);
    return record;
  }

  record(stageRecord, stage, testCase, outcome) {
    const result = {
      id: testCase.id,
      stage: stage.id,
      title: testCase.title,
      requirement: testCase.requirement || "",
      input: testCase.input || "",
      expected: testCase.expect || "",
      actual: outcome.actual == null ? "" : String(outcome.actual),
      status: outcome.status,
      ms: Math.round(outcome.ms),
      reason: outcome.reason || "",
      error: outcome.error ? this.describeError(outcome.error) : "",
    };
    this.results.push(result);
    stageRecord[result.status] += 1;
    this.show(result);
  }

  describeError(error) {
    const message = String(error?.message || error).split("\n").slice(0, 12).join("\n");
    return message;
  }

  show(result) {
    const badge = result.status === "pass" ? paint.green(ICON.pass) : result.status === "fail" ? paint.red(ICON.fail) : paint.yellow(ICON.skip);
    const time = paint.dim(`${result.ms} ms`);
    this.print(`  ${badge}  ${paint.bold(result.id)}  ${clip(result.title, 30)} ${time}`);
    if (this.detail >= 2 && result.requirement) this.print(paint.dim(`        why:      ${clip(result.requirement, 18)}`));
    if (this.detail >= 2 && result.input) this.print(paint.dim(`        input:    ${clip(result.input, 18)}`));
    if (result.status === "skip") {
      this.print(paint.yellow(`        skipped:  ${clip(result.reason, 18)}`));
    } else if (result.status === "fail") {
      this.print(paint.dim(`        expected: ${clip(result.expected, 18)}`));
      for (const line of result.error.split("\n")) this.print(paint.red(`        ${clip(line, 8)}`));
    } else if (this.detail >= 1) {
      this.print(paint.dim(`        expected: ${clip(result.expected, 18)}`));
      this.print(paint.dim(`        observed: ${clip(result.actual, 18)}`));
    }
  }

  get totals() {
    const count = (status) => this.results.filter((r) => r.status === status).length;
    return { total: this.results.length, pass: count("pass"), fail: count("fail"), skip: count("skip") };
  }

  summary({ extraLines = [] } = {}) {
    const { total, pass, fail, skip } = this.totals;
    this.print("");
    this.print(paint.bold("SUMMARY"));
    this.print(paint.dim("  stage                                          pass  fail  skip     time"));
    for (const s of this.stages) {
      const name = `${s.id}  ${s.title}`.padEnd(46).slice(0, 46);
      const failCell = s.fail ? paint.red(String(s.fail).padStart(4)) : String(s.fail).padStart(4);
      this.print(`  ${name} ${String(s.pass).padStart(4)}  ${failCell}  ${String(s.skip).padStart(4)}  ${String(s.ms).padStart(6)} ms`);
    }
    for (const line of extraLines) this.print(paint.dim(`  ${line}`));
    const verdict = fail ? paint.red(`FAILED: ${fail} of ${total} cases failed`) : paint.green(`ALL PASSED: ${pass} of ${total} cases passed`) + (skip ? paint.yellow(`, ${skip} skipped`) : "");
    this.print("");
    this.print(`  ${paint.bold(verdict)}`);
    if (fail) {
      this.print("");
      this.print(paint.red("  Failed cases:"));
      for (const r of this.results.filter((x) => x.status === "fail")) this.print(paint.red(`    ${r.id}  ${r.title}`));
    }
  }

  toJSON() {
    return { generatedAt: new Date().toISOString(), totals: this.totals, stages: this.stages, cases: this.results };
  }

  toMarkdown() {
    const { total, pass, fail, skip } = this.totals;
    const lines = [
      `# Hiring pipeline demo run`,
      "",
      `Run at ${new Date().toISOString()}: **${pass} passed, ${fail} failed, ${skip} skipped** of ${total} cases.`,
      "",
      "| ID | Stage | Case | Expected | Observed | Result |",
      "|---|---|---|---|---|---|",
    ];
    const cell = (text) => String(text || "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
    for (const r of this.results) {
      lines.push(`| ${r.id} | ${r.stage} | ${cell(r.title)} | ${cell(r.expected)} | ${cell(r.status === "pass" ? r.actual : r.status === "skip" ? r.reason : r.error)} | ${r.status.toUpperCase()} |`);
    }
    return `${lines.join("\n")}\n`;
  }
}
