import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  putObject, getObjectStream, getSignedUrl, listKeys, deleteObject,
  createSignedToken, verifySignedToken, assertValidKey, StorageError,
} from "../../libs/hiring/storage";

let dir;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "raasta-storage-"));
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

test("local driver: put, stream, list and delete", async () => {
  await putObject("resumes/job-1/a.pdf", Buffer.from("PDF-A"), "application/pdf");
  await putObject("resumes/job-1/b.txt", Buffer.from("hello"), "text/plain");
  await putObject("resumes/job-2/c.txt", Buffer.from("other job"), "text/plain");

  const { stream, contentType, size } = await getObjectStream("resumes/job-1/a.pdf");
  assert.equal(contentType, "application/pdf");
  assert.equal(size, 5);
  assert.equal(await readAll(stream), "PDF-A");

  assert.deepEqual(await listKeys("resumes/job-1/"), ["resumes/job-1/a.pdf", "resumes/job-1/b.txt"]);
  assert.deepEqual(await listKeys("resumes/job-1/b"), ["resumes/job-1/b.txt"]); // prefix mid-name
  assert.equal((await listKeys("")).length, 3); // sidecar metadata files are hidden

  await deleteObject("resumes/job-1/a.pdf");
  await assert.rejects(getObjectStream("resumes/job-1/a.pdf"), { code: "not_found" });
  assert.deepEqual(await listKeys("resumes/job-1/"), ["resumes/job-1/b.txt"]);
});

test("keys cannot escape the storage folder", async () => {
  for (const bad of ["../etc/passwd", "/abs/path", "a/../../b", "a//b", "a\\\\b", "", "x.meta.json"]) {
    assert.throws(() => assertValidKey(bad), StorageError, bad);
  }
  await assert.rejects(putObject("../outside.txt", Buffer.from("x")), { code: "invalid_key" });
  assert.equal(fs.existsSync(path.join(dir, "..", "outside.txt")), false);
});

test("signed URLs round-trip and carry the download filename", async () => {
  const url = await getSignedUrl("resumes/job-1/b.txt", 60, { filename: "Bilal CV.txt" });
  assert.match(url, /^\/api\/files\/[\w-]+\.[\w-]+$/);
  const { key, filename } = verifySignedToken(url.replace("/api/files/", ""));
  assert.equal(key, "resumes/job-1/b.txt");
  assert.equal(filename, "Bilal CV.txt");
});

test("tampered, malformed and expired tokens are rejected", () => {
  const token = createSignedToken("resumes/job-1/b.txt", 60);
  const [data, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ k: "resumes/job-2/c.txt", e: 9999999999 })).toString("base64url");
  for (const bad of [`${forged}.${sig}`, `${data}.${sig}x`, data, `${token}.extra`, "", undefined]) {
    assert.throws(() => verifySignedToken(bad), { code: "invalid_token" });
  }
  const expired = createSignedToken("resumes/job-1/b.txt", 1);
  const realNow = Date.now;
  Date.now = () => realNow() + 5000;
  try {
    assert.throws(() => verifySignedToken(expired), { code: "invalid_token" });
  } finally {
    Date.now = realNow;
  }
});

test("a missing signing secret is a configuration error", () => {
  const saved = process.env.STORAGE_SIGNING_SECRET;
  delete process.env.STORAGE_SIGNING_SECRET;
  try {
    assert.throws(() => createSignedToken("a/b.txt"), { code: "config" });
    assert.throws(() => verifySignedToken("x.y"), { code: "config" });
  } finally {
    process.env.STORAGE_SIGNING_SECRET = saved;
  }
});
