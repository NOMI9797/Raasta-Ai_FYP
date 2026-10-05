// Opening the first screens after `npm run dev` starts, so they are compiled before somebody signs in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { WARMUP_PATHS, runWarmup, warmupEnabled } from "../../libs/system/dev-warmup";

const quiet = () => {};
const instant = () => Promise.resolve();

test("warmupEnabled: development only, and DEV_WARMUP=false turns it off", () => {
  assert.equal(warmupEnabled({ NODE_ENV: "development" }), true);
  assert.equal(warmupEnabled({ NODE_ENV: "development", DEV_WARMUP: "false" }), false);
  assert.equal(warmupEnabled({ NODE_ENV: "development", DEV_WARMUP: " FALSE " }), false);
  assert.equal(warmupEnabled({ NODE_ENV: "production" }), false);
  assert.equal(warmupEnabled({}), false);
});

test("the sign-in screens come first, then Home, then the hiring screens", () => {
  assert.deepEqual(WARMUP_PATHS.slice(0, 4), ["/signin", "/api/auth/session", "/dashboard", "/dashboard/home"]);
  assert.ok(WARMUP_PATHS.every((p) => p.startsWith("/")));
  assert.equal(new Set(WARMUP_PATHS).size, WARMUP_PATHS.length, "no screen twice");
});

test("runWarmup requests each path in order, on the port Next reports, after the server is up", async () => {
  const requested = [];
  let checks = 0;
  const result = await runWarmup({
    env: { NODE_ENV: "development", PORT: "9123" },
    paths: ["/a", "/b", "/c"],
    isUp: async (port) => { assert.equal(port, 9123); return ++checks > 2; },
    get: async (url) => { requested.push(url); },
    sleep: instant,
    log: quiet,
  });
  assert.equal(checks, 3, "waited until the server answered");
  assert.deepEqual(requested, ["http://localhost:9123/a", "http://localhost:9123/b", "http://localhost:9123/c"]);
  assert.deepEqual(result, { warmed: 3, skipped: 0 });
});

test("runWarmup skips a screen that fails and keeps going", async () => {
  const requested = [];
  const result = await runWarmup({
    env: { NODE_ENV: "development" },
    paths: ["/a", "/b", "/c"],
    isUp: async () => true,
    get: async (url) => { requested.push(url); if (url.endsWith("/b")) throw new Error("boom"); },
    sleep: instant,
    log: quiet,
  });
  assert.equal(requested.length, 3);
  assert.deepEqual(result, { warmed: 2, skipped: 1 });
});

test("runWarmup does nothing in production or when switched off", async () => {
  for (const env of [{ NODE_ENV: "production" }, { NODE_ENV: "development", DEV_WARMUP: "false" }]) {
    let asked = false;
    const result = await runWarmup({ env, paths: ["/a"], isUp: async () => { asked = true; return true; }, get: async () => { asked = true; }, sleep: instant, log: quiet });
    assert.equal(result.skipped, "off");
    assert.equal(asked, false);
  }
});
