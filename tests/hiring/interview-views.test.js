import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, RECORDING_URL_SECONDS, ViewError, countRecordingParts, parseListFilters, signRecording } from "../../libs/hiring/interview-views";
import { INTERVIEW_STATUS } from "../../libs/hiring/statuses";

test("list filters: defaults, paging limits and empty values", () => {
  assert.deepEqual(parseListFilters({}), { jobId: null, status: null, from: null, to: null, page: 1, pageSize: DEFAULT_PAGE_SIZE });
  assert.equal(parseListFilters({ page: "0" }).page, 1);
  assert.equal(parseListFilters({ page: "abc" }).page, 1);
  assert.equal(parseListFilters({ page: "3" }).page, 3);
  assert.equal(parseListFilters({ pageSize: "9999" }).pageSize, MAX_PAGE_SIZE);
  assert.equal(parseListFilters({ pageSize: "-4" }).pageSize, 1);
  assert.equal(parseListFilters({ pageSize: "10" }).pageSize, 10);
  assert.equal(parseListFilters({ jobId: "", status: "" }).jobId, null);
});

test("list filters: status must be a real interview status", () => {
  for (const status of Object.values(INTERVIEW_STATUS)) assert.equal(parseListFilters({ status }).status, status);
  assert.throws(() => parseListFilters({ status: "shortlisted" }), (e) => e instanceof ViewError && e.code === "invalid_status" && e.status === 400);
});

test("list filters: dates; a day given as `to` includes the whole day", () => {
  const f = parseListFilters({ from: "2026-10-01", to: "2026-10-03" });
  assert.equal(f.from.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(f.to.toISOString(), "2026-10-04T00:00:00.000Z");
  // A full timestamp is taken as given
  assert.equal(parseListFilters({ to: "2026-10-03T12:00:00Z" }).to.toISOString(), "2026-10-03T12:00:00.000Z");
  assert.throws(() => parseListFilters({ from: "not a date" }), (e) => e instanceof ViewError && e.code === "invalid_date");
  assert.throws(() => parseListFilters({ to: "2026-13-45" }), (e) => e instanceof ViewError);
});

test("recording links: an async signer is awaited, so the result is a string, not a promise", async () => {
  const calls = [];
  const asyncSigner = async (key, seconds, options) => { calls.push([key, seconds, options]); return `/api/files/${key}`; };
  const url = await signRecording("recordings/i-1/audio.webm", "interview-audio.webm", asyncSigner);
  assert.equal(url, "/api/files/recordings/i-1/audio.webm");
  assert.deepEqual(calls[0], ["recordings/i-1/audio.webm", RECORDING_URL_SECONDS, { filename: "interview-audio.webm" }]);
  assert.equal(RECORDING_URL_SECONDS, 900);
  // A plain (sync) signer works too
  assert.equal(await signRecording("k", "f", () => "sync-url"), "sync-url");
});

test("recording links: no key, or a signer that fails (sync or async), means no link instead of an error", async () => {
  assert.equal(await signRecording(null, "f", async () => "never"), null);
  assert.equal(await signRecording("k", "f", () => { throw new Error("STORAGE_SIGNING_SECRET must be set"); }), null);
  assert.equal(await signRecording("k", "f", async () => { throw new Error("s3 down"); }), null);
});

test("recording parts: counted per kind, so 'nothing arrived' differs from 'it arrived but could not be joined'", async () => {
  const keys = ["recordings/i-1/audio/00000.webm", "recordings/i-1/audio/00001.webm", "recordings/i-1/video/00000.webm", "recordings/i-1/video/readme.txt"];
  const list = async (prefix) => keys.filter((k) => k.startsWith(prefix));
  assert.deepEqual(await countRecordingParts("i-1", list), { audio: 2, video: 1 });
  assert.deepEqual(await countRecordingParts("i-2", async () => []), { audio: 0, video: 0 });
  assert.deepEqual(await countRecordingParts("i-1", async () => { throw new Error("storage down"); }), { audio: null, video: null });
});
