// Screenshots of a posting run, one per step, so the Publish panel can show what the window looked like. They are kept on
// the machine that runs the engine under .runtime/poster-runs/<run id>/ (git-ignored; the newest 15 runs are kept) and are
// served only to the person who owns the run. The signed-in account's name in the page header is blacked out before the
// picture is taken. Recording is best effort: a screenshot that fails never fails the run.
// Relative imports only (also used by the engine process).
import fs from "node:fs";
import path from "node:path";
import { isShotName } from "./run-model";

const KEEP_RUNS = 15;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// What shows who is signed in: Indeed's header account button, and on Rozee.pk's sidebar the name, email and phone. Painted over
// in every picture
const MASKED = ['[data-testid="account-menu-toggle-expand"]', "#gnav-ENCEmpcenterIcon"];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE = /\+?\d[\d\s-]{8,}\d/;

export const shotsRoot = (env = process.env, cwd = process.cwd()) => path.resolve(cwd, env.POSTER_SHOTS_DIR || path.join(".runtime", "poster-runs"));

/** The file for a screenshot of a run, or null when the run id or the name is not what the engine writes. */
export function shotPath(runId, name, { env = process.env, cwd = process.cwd() } = {}) {
  if (!RUN_ID.test(String(runId || "")) || !isShotName(name)) return null;
  return path.join(shotsRoot(env, cwd), runId, name);
}

export async function pruneShots({ env = process.env, cwd = process.cwd(), keep = KEEP_RUNS } = {}) {
  const root = shotsRoot(env, cwd);
  try {
    const entries = (await fs.promises.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory());
    const dated = await Promise.all(entries.map(async (e) => ({ name: e.name, time: (await fs.promises.stat(path.join(root, e.name))).mtimeMs })));
    dated.sort((a, b) => b.time - a.time);
    for (const old of dated.slice(keep)) await fs.promises.rm(path.join(root, old.name), { recursive: true, force: true });
  } catch {
    /* housekeeping */
  }
}

/** A store for one run's screenshots: save(page, stepId) -> file name, or null when the picture could not be taken. */
export function createShotStore({ runId, env = process.env, cwd = process.cwd() }) {
  if (!RUN_ID.test(String(runId || ""))) throw new Error("A screenshot store needs a run id");
  const dir = path.join(shotsRoot(env, cwd), runId);
  let count = 0;
  return {
    dir,
    async save(page, stepId) {
      try {
        await fs.promises.mkdir(dir, { recursive: true });
        count += 1;
        const slug = String(stepId || "step").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "step";
        const name = `${String(count).padStart(2, "0")}-${slug}.jpg`;
        await page.screenshot({
          path: path.join(dir, name),
          type: "jpeg",
          quality: 62,
          timeout: 8000,
          mask: [...MASKED.map((selector) => page.locator(selector)), page.getByText(EMAIL), page.getByText(PHONE)],
          maskColor: "#3a3a3a",
        });
        return name;
      } catch {
        return null;
      }
    },
  };
}
