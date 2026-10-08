#!/usr/bin/env node
// Puts the face-tracking runtime where the interview room loads it from (public/mediapipe/):
//   wasm/   the MediaPipe WebAssembly runtime, copied from node_modules/@mediapipe/tasks-vision
//   face_landmarker.task   the face model (about 4 MB), copied from the AI engine's model folder when
//                          it is there, otherwise downloaded once from Google's model storage
// Serving these from the app means the candidate's browser never contacts a third party, and the
// interview works offline from the candidate's side of the internet. Both are git-ignored.
//
// Usage: npm run sync:mediapipe
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const target = path.join(root, "public", "mediapipe");
const wasmSource = path.join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const MODEL_NAME = "face_landmarker.task";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const ENGINE_MODEL = path.join(root, "services", "ai-engine", ".models", MODEL_NAME);

function copyWasm() {
  if (!fs.existsSync(wasmSource)) {
    throw new Error("@mediapipe/tasks-vision is not installed. Run: npm install");
  }
  const out = path.join(target, "wasm");
  fs.mkdirSync(out, { recursive: true });
  for (const file of fs.readdirSync(wasmSource)) fs.copyFileSync(path.join(wasmSource, file), path.join(out, file));
  console.log(`runtime: copied ${fs.readdirSync(out).length} files to public/mediapipe/wasm`);
}

async function ensureModel() {
  const out = path.join(target, MODEL_NAME);
  if (fs.existsSync(out) && fs.statSync(out).size > 1_000_000) {
    console.log("model: already in public/mediapipe");
    return;
  }
  fs.mkdirSync(target, { recursive: true });
  if (fs.existsSync(ENGINE_MODEL)) {
    fs.copyFileSync(ENGINE_MODEL, out);
    console.log("model: copied from services/ai-engine/.models");
    return;
  }
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`model download failed: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 1_000_000) throw new Error("model download looks incomplete");
  fs.writeFileSync(out, bytes);
  console.log(`model: downloaded (${(bytes.length / 1e6).toFixed(1)} MB)`);
}

(async () => {
  copyWasm();
  await ensureModel();
})().catch((error) => {
  console.error(`sync:mediapipe failed: ${error.message}`);
  process.exit(1);
});
