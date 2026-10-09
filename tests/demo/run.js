// Demo test cases for the AI hiring pipeline (docs/ai-hiring/22-demo-test-cases.md).
//
//   npm run demo:tests                  stages 1-5: offline, no database, no network (about 10 s)
//   npm run demo:tests -- --db          + stage 6: one candidate through the real database
//   npm run demo:tests -- --live        + stage 7: the real language model (needs GROQ_API_KEY)
//   npm run demo:tests -- --all         everything
//   npm run demo:tests -- --stage 3,4   only those stages        --list   show the catalogue
//   --brief / --verbose                 less / more text per case  --pace 400  pause (ms) between cases
//   --json out.json  --markdown out.md  save the results
import "../../libs/load-env"; // first: the database client reads DATABASE_URL when it loads
import fs from "fs";
import { parseArgs } from "node:util";
import { Runner, paint } from "./runner";
import { installTripwire, removeTripwire, resetTripwire, tripwireAttempts } from "./tripwire";
import stage1 from "./stage1-screening";
import stage2 from "./stage2-shortlist";
import stage3 from "./stage3-invitation";
import stage4 from "./stage4-interview";
import stage5 from "./stage5-evaluation";

const HELP = `Demo test cases for the hiring pipeline
  --db            add stage 6 (real Postgres, throw-away data, cleaned up afterwards)
  --live          add stage 7 (real language model; costs a few dozen small requests)
  --all           stages 1-7
  --stage 1,3     run only these stages
  --list          print the catalogue without running anything
  --brief         one line per case        --verbose  also show the requirement and input
  --pace 400      wait this many ms between cases (for talking through a demo)
  --json F        write results as JSON    --markdown F  write results as a Markdown table`;

async function loadStages(ids) {
  const stages = [stage1, stage2, stage3, stage4, stage5];
  if (ids.includes(6)) stages.push((await import("./stage6-database")).default);
  if (ids.includes(7)) stages.push((await import("./stage7-live")).default);
  return stages.filter((s) => ids.includes(s.id)).sort((a, b) => a.id - b.id);
}

async function main() {
  const { values } = parseArgs({
    options: {
      db: { type: "boolean" }, live: { type: "boolean" }, all: { type: "boolean" }, stage: { type: "string" },
      list: { type: "boolean" }, brief: { type: "boolean" }, verbose: { type: "boolean" }, pace: { type: "string" },
      json: { type: "string" }, markdown: { type: "string" }, help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }

  let ids = [1, 2, 3, 4, 5];
  if (values.all) ids = [1, 2, 3, 4, 5, 6, 7];
  else {
    if (values.db) ids.push(6);
    if (values.live) ids.push(7);
  }
  if (values.stage) ids = values.stage.split(",").map((n) => Number(n.trim())).filter((n) => n >= 1 && n <= 7);
  const stages = await loadStages(ids);

  if (values.list) {
    for (const stage of stages) {
      console.log(`\nSTAGE ${stage.id}  ${stage.title}  [${stage.tier}]`);
      for (const c of stage.cases) console.log(`  ${c.id}  ${c.title}\n          expect: ${c.expect}`);
    }
    return 0;
  }

  const runner = new Runner({ detail: values.brief ? 0 : values.verbose ? 2 : 1, paceMs: Number(values.pace) || 0 });
  runner.print(paint.bold("Raasta-AI hiring pipeline: demo test cases"));
  runner.print(paint.dim(`  ${new Date().toISOString()} · node ${process.version} · stages ${ids.join(", ")}`));

  resetTripwire();
  installTripwire();
  let offlineStagesRan = false;
  for (const stage of stages) {
    if (stage.tier === "live") removeTripwire();
    await runner.runStage(stage);
    if (stage.tier === "offline") offlineStagesRan = true;
  }

  const attempts = tripwireAttempts();
  const extra = [];
  if (offlineStagesRan) extra.push(`Language-model calls attempted by the offline stages: ${attempts}${attempts ? "  <-- this is a failure" : "  (none, as required)"}`);
  runner.summary({ extraLines: extra });

  if (values.json) fs.writeFileSync(values.json, JSON.stringify(runner.toJSON(), null, 2));
  if (values.markdown) fs.writeFileSync(values.markdown, runner.toMarkdown());
  if (values.json || values.markdown) runner.print(paint.dim(`  results saved: ${[values.json, values.markdown].filter(Boolean).join(", ")}`));

  return runner.totals.fail > 0 || attempts > 0 ? 1 : 0;
}

main()
  .then(async (code) => {
    await globalThis.pgClient?.end({ timeout: 2 }).catch(() => {});
    process.exit(code);
  })
  .catch(async (error) => {
    console.error(error);
    await globalThis.pgClient?.end({ timeout: 2 }).catch(() => {});
    process.exit(1);
  });
