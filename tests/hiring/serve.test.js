// The fast local mode (scripts/serve.js): when it builds, and the options it understands.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const { parseArgs, buildReason, newestSourceTime } = createRequire(import.meta.url)("../../scripts/serve.js");

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "serve-"));
  fs.mkdirSync(path.join(root, "app"));
  fs.mkdirSync(path.join(root, "libs"));
  fs.writeFileSync(path.join(root, "app", "page.js"), "export default 1;");
  fs.writeFileSync(path.join(root, "package.json"), "{}");
  return root;
}
const touch = (file, seconds) => fs.utimesSync(file, seconds, seconds);

test("parseArgs: defaults, flags and port", () => {
  assert.deepEqual(parseArgs([], {}), { rebuild: false, build: true, port: 8085 });
  assert.equal(parseArgs(["--rebuild"], {}).rebuild, true);
  assert.equal(parseArgs(["--no-build"], {}).build, false);
  assert.equal(parseArgs(["--port", "9000"], {}).port, 9000);
  assert.equal(parseArgs([], { PORT: "7000" }).port, 7000);
  assert.equal(parseArgs(["--port", "abc"], {}).port, 8085, "a bad port falls back");
});

test("buildReason: builds when there is no build, when the code is newer, or when asked; skips otherwise", () => {
  const root = project();
  try {
    assert.match(buildReason({ rebuild: false }, root), /no build/);

    fs.mkdirSync(path.join(root, ".next-prod"));
    const marker = path.join(root, ".next-prod", "BUILD_ID");
    fs.writeFileSync(marker, "id");
    touch(path.join(root, "app", "page.js"), 1000);
    touch(path.join(root, "package.json"), 1000);
    touch(marker, 2000);
    assert.equal(buildReason({ rebuild: false }, root), null, "build is newer than the code");
    assert.match(buildReason({ rebuild: true }, root), /asked/);

    touch(path.join(root, "app", "page.js"), 3000);
    assert.match(buildReason({ rebuild: false }, root), /changed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("newestSourceTime ignores node_modules and build folders", () => {
  const root = project();
  try {
    touch(path.join(root, "app", "page.js"), 1000);
    touch(path.join(root, "package.json"), 1000);
    for (const dir of ["app/node_modules", "app/.next-prod"]) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
      fs.writeFileSync(path.join(root, dir, "x.js"), "x"); // fresh files that must not count
    }
    assert.equal(Math.round(newestSourceTime(root) / 1000), 1000);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
