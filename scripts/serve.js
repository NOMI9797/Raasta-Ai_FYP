#!/usr/bin/env node
// Fast local mode: runs the web app as a production build on the same port as `npm run dev`.
//
//   npm run serve                 build if the code changed, then start on http://localhost:8085
//   npm run serve -- --rebuild    build again even if nothing changed
//   npm run serve -- --no-build   start the last build as it is
//   npm run serve -- --port 8090  another port (NEXTAUTH_URL must match it for sign-in)
//
// `npm run dev` compiles every screen the first time it is opened and ships about 12 MB of unminified
// JavaScript, which is slow on a laptop. A production build is compiled once, so screens open in a
// fraction of a second. The build goes into .next-prod, so it never touches a running `npm run dev`.
// The hiring worker is still started by the web server (see docs/ai-hiring/20-setup-and-services.md).
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST_DIR = ".next-prod";
const NEXT_BIN = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");

// What a build depends on: when one of these is newer than the last build, it is built again
const SOURCE_DIRS = ["app", "components", "libs"];
const SOURCE_FILES = [
  "config.js", "next.config.js", "tailwind.config.js", "postcss.config.js", "jsconfig.json", "package.json",
  "instrumentation.js", "instrumentation-node.js", ".env", ".env.local", ".env.production", ".env.production.local",
];

function parseArgs(argv, env) {
  const options = { rebuild: false, build: true, port: Number(env.PORT) || 8085 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--rebuild") options.rebuild = true;
    else if (argv[i] === "--no-build") options.build = false;
    else if (argv[i] === "--port") options.port = Number(argv[++i]) || options.port;
  }
  return options;
}

/** The newest modification time (ms) of the files a build depends on. */
function newestSourceTime(root = ROOT) {
  let newest = 0;
  const visit = (file) => {
    let stat;
    try { stat = fs.statSync(file); } catch { return; }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file)) if (name !== "node_modules" && !name.startsWith(".next")) visit(path.join(file, name));
    } else if (stat.mtimeMs > newest) {
      newest = stat.mtimeMs;
    }
  };
  for (const dir of SOURCE_DIRS) visit(path.join(root, dir));
  for (const file of SOURCE_FILES) visit(path.join(root, file));
  return newest;
}

/** Why a build is needed, or null when the last build is still current. */
function buildReason({ rebuild }, root = ROOT) {
  if (rebuild) return "you asked for a rebuild";
  const marker = path.join(root, DIST_DIR, "BUILD_ID");
  let built;
  try { built = fs.statSync(marker).mtimeMs; } catch { return "there is no build yet"; }
  return newestSourceTime(root) > built ? "the code changed since the last build" : null;
}

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2), process.env);
  if (await portInUse(options.port)) {
    console.error(`Port ${options.port} is already in use. If it is \`npm run dev\`, stop it first (Ctrl+C in its terminal), then run this again.`);
    process.exit(1);
  }

  const env = { ...process.env, NEXT_DIST_DIR: DIST_DIR, NEXT_TELEMETRY_DISABLED: "1" };
  delete env.NODE_ENV; // next picks production for build and start

  const reason = options.build ? buildReason(options) : null;
  if (!options.build && !fs.existsSync(path.join(ROOT, DIST_DIR, "BUILD_ID"))) {
    console.error("There is no build yet. Run `npm run serve` without --no-build.");
    process.exit(1);
  }
  if (reason) {
    console.log(`Building the web app (${reason}). This takes a few minutes; later starts are instant while the code is unchanged.`);
    const built = spawnSync(process.execPath, [NEXT_BIN, "build"], { cwd: ROOT, env, stdio: "inherit" });
    if (built.status !== 0) {
      console.error("The build failed, so the web app was not started. Fix the errors above and run this again.");
      process.exit(built.status || 1);
    }
  } else {
    console.log("Using the last build (the code has not changed). Add --rebuild to build it again.");
  }

  // A fast local run is not a deployment: keep the dev conveniences that production switches off
  env.SERVICE_CONTROL = env.SERVICE_CONTROL || "true"; // Setup guide can start / stop the other programs
  env.EMAIL_OUTBOX = env.EMAIL_OUTBOX || "local";       // without a Mailgun key, emails go to .storage/outbox
  console.log(`Starting the web app in fast mode on http://localhost:${options.port}`);
  const server = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(options.port)], { cwd: ROOT, env, stdio: "inherit" });
  const stop = () => server.kill();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  server.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

if (require.main === module) {
  main().catch((error) => { console.error(error?.message || error); process.exit(1); });
}

module.exports = { parseArgs, newestSourceTime, buildReason };
