import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { putObject, getObjectStream, parseRange } from "../../libs/hiring/storage";

let dir;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "raasta-range-"));
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_LOCAL_DIR = dir;
  process.env.STORAGE_SIGNING_SECRET = "storage-test-secret-0123456789abcdef";
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

test("parseRange: start-end, open end and suffix ranges", () => {
  assert.deepEqual(parseRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange("bytes=500-", 1000), { start: 500, end: 999 });
  assert.deepEqual(parseRange("bytes=-100", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange("bytes=-5000", 1000), { start: 0, end: 999 }); // suffix longer than the file
  assert.deepEqual(parseRange("bytes=900-5000", 1000), { start: 900, end: 999 }); // end clamped to the size
  assert.deepEqual(parseRange(" bytes=10-20 ", 1000), { start: 10, end: 20 });
});

test("parseRange: unsatisfiable ranges get a 416, anything odd is ignored", () => {
  assert.equal(parseRange("bytes=1000-", 1000), "unsatisfiable");
  assert.equal(parseRange("bytes=2000-3000", 1000), "unsatisfiable");
  assert.equal(parseRange("bytes=-0", 1000), "unsatisfiable");
  for (const ignored of [null, "", "bytes=", "bytes=-", "items=0-5", "bytes=0-5,10-20", "bytes=50-10", "bytes=a-b", "garbage"]) {
    assert.equal(parseRange(ignored, 1000), null, String(ignored));
  }
  assert.equal(parseRange("bytes=0-5", 0), null); // an empty file is served whole
});

test("local driver honours a byte range and says so; no range returns the whole object", async () => {
  await putObject("recordings/i-1/audio.webm", Buffer.from("0123456789"), "audio/webm");

  const part = await getObjectStream("recordings/i-1/audio.webm", { range: { start: 2, end: 5 } });
  assert.equal(await readAll(part.stream), "2345");
  assert.deepEqual(part.range, { start: 2, end: 5 });
  assert.equal(part.size, 10);
  assert.equal(part.contentType, "audio/webm");

  const whole = await getObjectStream("recordings/i-1/audio.webm");
  assert.equal(await readAll(whole.stream), "0123456789");
  assert.equal(whole.range, undefined);
});
