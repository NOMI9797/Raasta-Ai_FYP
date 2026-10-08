// Joining uploaded recording parts with the real ffmpeg (skipped where ffmpeg isn't installed).
// MediaRecorder chunks are plain byte slices of one stream, so the parts here are byte slices too;
// a page reload mid-interview gives a second stream, which must be joined after the first.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { MediaToolError, concatInStorage, decodeToSamples, ffmpegAvailable, groupIntoStreams, runFfmpeg } from "../../libs/interview/media-tools";

// Skip (not fail) on a machine without ffmpeg
async function ffmpegOrSkip(t) {
  if (await ffmpegAvailable()) return true;
  t.skip("ffmpeg is not installed");
  return false;
}

async function makeWebm(dir, name, seconds, frequency) {
  const file = path.join(dir, name);
  await runFfmpeg(["-y", "-f", "lavfi", "-i", `sine=frequency=${frequency}:duration=${seconds}`, "-c:a", "libopus", "-b:a", "32k", file]);
  return fs.readFile(file);
}

/** Cut a recording into n byte slices, like MediaRecorder timeslices. */
const slices = (buffer, n) => Array.from({ length: n }, (_, i) => buffer.subarray(Math.floor((i * buffer.length) / n), Math.floor(((i + 1) * buffer.length) / n)));

function storage(files) {
  const objects = new Map(Object.entries(files));
  return {
    objects,
    list: async (prefix) => [...objects.keys()].filter((k) => k.startsWith(prefix)).sort(),
    fetch: async (key, file) => fs.writeFile(file, objects.get(key)),
    put: async (key, file) => { objects.set(key, await fs.readFile(file)); },
  };
}

test("parts of one recording are joined into a file of the right length", async (t) => {
  if (!(await ffmpegOrSkip(t))) return;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "raasta-test-"));
  try {
    const whole = await makeWebm(dir, "a.webm", 6, 440);
    const parts = slices(whole, 5);
    const files = Object.fromEntries(parts.map((p, i) => [`recordings/iv/audio/${String(i).padStart(5, "0")}.webm`, p]));
    const s = storage(files);
    const result = await concatInStorage("recordings/iv/audio/", "recordings/iv/audio.webm", s);
    assert.equal(result.parts, 5);
    assert.equal(result.streams, 1);
    const out = path.join(dir, "out.webm");
    await fs.writeFile(out, s.objects.get("recordings/iv/audio.webm"));
    const { samples, rate } = await decodeToSamples(out);
    assert.ok(Math.abs(samples.length / rate - 6) < 0.3, `duration ${samples.length / rate}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a reload mid-interview (a second stream) is appended, not lost; headerless leading parts are dropped", async (t) => {
  if (!(await ffmpegOrSkip(t))) return;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "raasta-test-"));
  try {
    const first = slices(await makeWebm(dir, "a.webm", 4, 440), 3);
    const second = slices(await makeWebm(dir, "b.webm", 3, 880), 2);
    // Part 0 is a stray fragment with no header (cannot be decoded): it is dropped
    const ordered = [Buffer.from("not a webm header"), ...first, ...second];
    const files = Object.fromEntries(ordered.map((p, i) => [`recordings/iv/audio/${String(i).padStart(5, "0")}.webm`, p]));
    // The stray part is part 0, so the first real stream starts at part 1
    const s = storage(files);
    const result = await concatInStorage("recordings/iv/audio/", "recordings/iv/audio.webm", s);
    assert.equal(result.streams, 2);
    const out = path.join(dir, "out.webm");
    await fs.writeFile(out, s.objects.get("recordings/iv/audio.webm"));
    const { samples, rate } = await decodeToSamples(out);
    assert.ok(Math.abs(samples.length / rate - 7) < 0.4, `duration ${samples.length / rate}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("part order is numeric, not alphabetical, and non-part keys are ignored", async (t) => {
  if (!(await ffmpegOrSkip(t))) return;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "raasta-test-"));
  try {
    const parts = slices(await makeWebm(dir, "a.webm", 3, 440), 12); // part 10 and 11 sort before part 2 as text
    const files = Object.fromEntries(parts.map((p, i) => [`recordings/iv/video/${i}.webm`, p]));
    files["recordings/iv/video/notes.txt"] = Buffer.from("ignore me");
    const s = storage(files);
    const result = await concatInStorage("recordings/iv/video/", "recordings/iv/video.webm", s);
    assert.equal(result.parts, 12);
    assert.equal(result.streams, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("nothing uploaded, or nothing decodable, is a clear error", async () => {
  await assert.rejects(concatInStorage("recordings/iv/audio/", "x.webm", storage({})), (e) => e instanceof MediaToolError && e.code === "no_parts");
  if (!(await ffmpegAvailable())) return;
  const junk = storage({ "recordings/iv/audio/00000.webm": Buffer.from("garbage"), "recordings/iv/audio/00001.webm": Buffer.from("more garbage") });
  await assert.rejects(concatInStorage("recordings/iv/audio/", "x.webm", junk), (e) => e instanceof MediaToolError && e.code === "no_header");
});

test("a missing ffmpeg is reported as such, with what to do", async () => {
  await assert.rejects(
    runFfmpeg(["-version"], { env: { FFMPEG_PATH: path.join(os.tmpdir(), "definitely-not-ffmpeg") } }),
    (e) => e instanceof MediaToolError && e.code === "ffmpeg_missing" && /FFMPEG_PATH/.test(e.message),
  );
  assert.equal(await ffmpegAvailable({ env: { FFMPEG_PATH: path.join(os.tmpdir(), "definitely-not-ffmpeg") } }), false);
});

test("stream grouping starts a new stream at every WebM header", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "raasta-test-"));
  try {
    const header = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2]);
    const body = Buffer.from([9, 9, 9, 9]);
    const names = ["p0", "p1", "p2", "p3", "p4"];
    const contents = [body, header, body, header, body]; // a headerless fragment first, then two streams
    const files = [];
    for (const [i, name] of names.entries()) {
      const file = path.join(dir, name);
      await fs.writeFile(file, contents[i]);
      files.push(file);
    }
    const streams = await groupIntoStreams(files);
    assert.deepEqual(streams.map((s) => s.map((f) => path.basename(f))), [["p1", "p2"], ["p3", "p4"]]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
