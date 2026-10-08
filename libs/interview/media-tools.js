// ffmpeg helpers for interview recordings: join the uploaded parts into one file and decode audio
// for analysis. Runs in the hiring worker with the ffmpeg program on this machine (FFMPEG_PATH, or
// "ffmpeg" on PATH), so recordings no longer depend on the Python AI engine being up.
// Relative imports only — runs in the hiring worker.
import { spawn } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { downloadToFile, putFile } from "../hiring/storage";

export const EBML_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]); // start of a WebM/Matroska file
export const PART_KEY = /\/(\d+)\.webm$/;
const FFMPEG_TIMEOUT_MS = 10 * 60 * 1000;

export class MediaToolError extends Error {
  /** code: ffmpeg_missing | ffmpeg_failed | no_parts | no_header */
  constructor(message, { code = "ffmpeg_failed" } = {}) {
    super(message);
    this.name = "MediaToolError";
    this.code = code;
  }
}

export function ffmpegPath(env = process.env) {
  return env.FFMPEG_PATH || "ffmpeg";
}

/** Run ffmpeg. Resolves { stdout: Buffer }; rejects with a MediaToolError that says what to do. */
export function runFfmpeg(args, { timeoutMs = FFMPEG_TIMEOUT_MS, spawnImpl = spawn, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(ffmpegPath(env), ["-nostdin", "-hide_banner", "-loglevel", "error", ...args], { windowsHide: true });
    } catch (error) {
      reject(new MediaToolError(`ffmpeg could not start: ${error.message}`, { code: "ffmpeg_missing" }));
      return;
    }
    const out = [];
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new MediaToolError(`ffmpeg timed out after ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => out.push(chunk));
    child.stderr?.on("data", (chunk) => { stderr = (stderr + chunk).slice(-600); });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error.code === "ENOENT"
        ? new MediaToolError("ffmpeg is not installed or is not on PATH. Install it, or set FFMPEG_PATH to its location.", { code: "ffmpeg_missing" })
        : new MediaToolError(`ffmpeg could not start: ${error.message}`, { code: "ffmpeg_missing" }));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout: Buffer.concat(out) });
      else reject(new MediaToolError(`ffmpeg failed (${code}): ${stderr.trim().slice(-300)}`));
    });
  });
}

export async function ffmpegAvailable(options) {
  try {
    await runFfmpeg(["-version"], { timeoutMs: 8000, ...options });
    return true;
  } catch {
    return false;
  }
}

async function startsWithHeader(file) {
  const handle = await fsp.open(file, "r");
  try {
    const head = Buffer.alloc(4);
    await handle.read(head, 0, 4, 0);
    return head.equals(EBML_MAGIC);
  } finally {
    await handle.close();
  }
}

/**
 * Parts → recorder streams. MediaRecorder chunks are byte fragments of one stream: only the first
 * has a WebM header. A page reload mid-interview starts a new recorder, so one interview can hold
 * several streams; a new stream begins at every part with a header. Leading parts without one
 * can't be decoded and are dropped.
 */
export async function groupIntoStreams(partFiles) {
  const streams = [];
  for (const file of partFiles) {
    if (await startsWithHeader(file)) streams.push([file]);
    else if (streams.length) streams.at(-1).push(file);
  }
  return streams;
}

/** Join local part files into outPath (each stream remuxed so it gets a duration and seek data). */
export async function concatPartFiles(partFiles, outPath, workDir) {
  if (!partFiles.length) throw new MediaToolError("No parts to join", { code: "no_parts" });
  const streams = await groupIntoStreams(partFiles);
  if (!streams.length) throw new MediaToolError("No part starts with a WebM header", { code: "no_header" });
  const remuxed = [];
  for (const [i, stream] of streams.entries()) {
    const raw = path.join(workDir, `stream${i}-raw.webm`);
    const out = fs.createWriteStream(raw);
    for (const part of stream) {
      await new Promise((resolve, reject) => {
        const src = fs.createReadStream(part);
        src.on("error", reject);
        src.on("end", resolve);
        src.pipe(out, { end: false });
      });
    }
    await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
    const fixed = path.join(workDir, `stream${i}.webm`);
    await runFfmpeg(["-y", "-i", raw, "-c", "copy", fixed]);
    remuxed.push(fixed);
  }
  if (remuxed.length === 1) {
    await fsp.copyFile(remuxed[0], outPath);
    return { streams: 1 };
  }
  const listing = path.join(workDir, "parts.txt");
  await fsp.writeFile(listing, remuxed.map((p) => `file '${path.resolve(p).split(path.sep).join("/")}'\n`).join(""));
  const joined = path.join(workDir, "joined.webm");
  try {
    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listing, "-c", "copy", joined]);
  } catch {
    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listing, joined]); // different stream parameters: re-encode
  }
  await runFfmpeg(["-y", "-i", joined, "-c", "copy", outPath]);
  return { streams: streams.length };
}

/**
 * Join the uploaded parts under `prefix` into `outKey` in storage.
 * deps: { list, fetch(key, file), put(key, file, type) } — injectable for tests.
 * Returns { outKey, parts, streams }.
 */
export async function concatInStorage(prefix, outKey, { list, fetch = downloadToFile, put = putFile } = {}) {
  const keys = (await list(prefix))
    .filter((key) => PART_KEY.test(key))
    .sort((a, b) => Number(PART_KEY.exec(a)[1]) - Number(PART_KEY.exec(b)[1]));
  if (!keys.length) throw new MediaToolError("No parts found", { code: "no_parts" });
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "raasta-rec-"));
  try {
    const files = [];
    for (const [i, key] of keys.entries()) {
      const file = path.join(workDir, `part-${String(i).padStart(5, "0")}`);
      await fetch(key, file);
      files.push(file);
    }
    const out = path.join(workDir, "out.webm");
    const { streams } = await concatPartFiles(files, out, workDir);
    await put(outKey, out, "video/webm");
    return { outKey, parts: keys.length, streams };
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Decode a media file to mono Float32 samples at `rate` Hz. */
export async function decodeToSamples(file, { rate = 16000 } = {}) {
  const { stdout } = await runFfmpeg(["-i", file, "-vn", "-ac", "1", "-ar", String(rate), "-f", "s16le", "pipe:1"]);
  const count = Math.floor(stdout.length / 2);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i += 1) samples[i] = stdout.readInt16LE(i * 2) / 32768;
  return { samples, rate };
}

/** Decode a stored recording (downloads it to a temp file first). */
export async function decodeStoredAudio(key, { fetch = downloadToFile, rate = 16000 } = {}) {
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "raasta-dec-"));
  try {
    const file = path.join(workDir, "audio.webm");
    await fetch(key, file);
    return await decodeToSamples(file, { rate });
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
