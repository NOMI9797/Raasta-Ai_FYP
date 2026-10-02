// Object storage for resumes and interview recordings (docs/ai-hiring/16-phases-and-prompts.md, Phase 1).
// Drivers: "local" (files under STORAGE_LOCAL_DIR) and "s3" (AWS S3, R2, MinIO via S3_ENDPOINT).
// Relative imports only — also used by the worker and interview engine.
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";

const META_SUFFIX = ".meta.json"; // local driver: sidecar holding the content type
const DEFAULT_URL_SECONDS = 300;

export class StorageError extends Error {
  constructor(message, { code = "storage_error" } = {}) {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}

export function getDriver() {
  return (process.env.STORAGE_DRIVER || "local").toLowerCase();
}

/**
 * Keys look like "resumes/<jobId>/<uuid>.pdf": forward slashes, no "..", no leading slash.
 */
export function assertValidKey(key) {
  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.length > 512 ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.includes("\0") ||
    key.endsWith(META_SUFFIX) ||
    key.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new StorageError("Invalid storage key", { code: "invalid_key" });
  }
  return key;
}

// ─── Local driver ───

function localBaseDir() {
  return path.resolve(process.env.STORAGE_LOCAL_DIR || "./.storage");
}

function localPath(key) {
  assertValidKey(key);
  const base = localBaseDir();
  const full = path.resolve(base, key);
  if (!full.startsWith(base + path.sep)) {
    throw new StorageError("Invalid storage key", { code: "invalid_key" });
  }
  return full;
}

const local = {
  async putObject(key, buffer, contentType) {
    const file = localPath(key);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, buffer);
    await fsp.writeFile(file + META_SUFFIX, JSON.stringify({ contentType: contentType || "application/octet-stream" }));
    return { key };
  },

  async getObjectStream(key) {
    const file = localPath(key);
    let stat;
    try {
      stat = await fsp.stat(file);
    } catch {
      throw new StorageError("Object not found", { code: "not_found" });
    }
    let contentType = "application/octet-stream";
    try {
      contentType = JSON.parse(await fsp.readFile(file + META_SUFFIX, "utf8")).contentType || contentType;
    } catch {
      // no sidecar — keep the default
    }
    return { stream: fs.createReadStream(file), contentType, size: stat.size };
  },

  async getSignedUrl(key, seconds, { filename } = {}) {
    assertValidKey(key);
    return `/api/files/${createSignedToken(key, seconds, { filename })}`;
  },

  async listKeys(prefix = "") {
    const base = localBaseDir();
    const start = prefix ? path.resolve(base, prefix) : base;
    if (start !== base && !start.startsWith(base + path.sep)) {
      throw new StorageError("Invalid prefix", { code: "invalid_key" });
    }
    // The prefix may end mid-name ("recordings/abc/audio/part-"), so walk its directory and filter
    const dir = prefix.endsWith("/") || start === base ? start : path.dirname(start);
    const keys = [];
    async function walk(current) {
      let entries;
      try {
        entries = await fsp.readdir(current, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (!entry.name.endsWith(META_SUFFIX)) keys.push(path.relative(base, full).split(path.sep).join("/"));
      }
    }
    await walk(dir);
    return keys.filter((k) => k.startsWith(prefix)).sort();
  },

  async deleteObject(key) {
    const file = localPath(key);
    await fsp.rm(file, { force: true });
    await fsp.rm(file + META_SUFFIX, { force: true });
  },
};

// ─── S3 driver ───

let s3Client = null;

async function getS3() {
  if (!s3Client) {
    const { S3Client } = await import("@aws-sdk/client-s3");
    const endpoint = process.env.S3_ENDPOINT || undefined;
    s3Client = new S3Client({
      region: process.env.S3_REGION || "auto",
      endpoint,
      forcePathStyle: Boolean(endpoint), // R2 / MinIO
      credentials: process.env.S3_ACCESS_KEY_ID
        ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "" }
        : undefined,
    });
  }
  return s3Client;
}

function bucket() {
  const name = process.env.S3_BUCKET;
  if (!name) throw new StorageError("S3_BUCKET is not set", { code: "config" });
  return name;
}

function contentDisposition(filename) {
  const safe = String(filename).replace(/[^\w.\- ]+/g, "_");
  return `attachment; filename="${safe}"`;
}

const s3 = {
  async putObject(key, buffer, contentType) {
    assertValidKey(key);
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await (await getS3()).send(new PutObjectCommand({
      Bucket: bucket(), Key: key, Body: buffer, ContentType: contentType || "application/octet-stream",
    }));
    return { key };
  },

  async getObjectStream(key) {
    assertValidKey(key);
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    try {
      const res = await (await getS3()).send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
      return { stream: res.Body, contentType: res.ContentType || "application/octet-stream", size: res.ContentLength ?? null };
    } catch (error) {
      if (error?.name === "NoSuchKey") throw new StorageError("Object not found", { code: "not_found" });
      throw error;
    }
  },

  async getSignedUrl(key, seconds, { filename } = {}) {
    assertValidKey(key);
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl: presign } = await import("@aws-sdk/s3-request-presigner");
    const command = new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ...(filename ? { ResponseContentDisposition: contentDisposition(filename) } : {}),
    });
    return presign(await getS3(), command, { expiresIn: seconds });
  },

  async listKeys(prefix = "") {
    const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
    const keys = [];
    let token;
    do {
      const res = await (await getS3()).send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, ContinuationToken: token }));
      for (const item of res.Contents || []) keys.push(item.Key);
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return keys.sort();
  },

  async deleteObject(key) {
    assertValidKey(key);
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await (await getS3()).send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
  },
};

function driver() {
  const name = getDriver();
  if (name === "local") return local;
  if (name === "s3") return s3;
  throw new StorageError(`Unknown STORAGE_DRIVER "${name}"`, { code: "config" });
}

// ─── Public API ───

export function putObject(key, buffer, contentType) {
  return driver().putObject(key, buffer, contentType);
}

/** Returns { stream, contentType, size }. Throws StorageError code "not_found" if missing. */
export function getObjectStream(key) {
  return driver().getObjectStream(key);
}

/** Short-lived download URL. Local driver: a relative "/api/files/<token>" URL served by the web app. */
export function getSignedUrl(key, seconds = DEFAULT_URL_SECONDS, options = {}) {
  return driver().getSignedUrl(key, seconds, options);
}

export function listKeys(prefix = "") {
  return driver().listKeys(prefix);
}

export function deleteObject(key) {
  return driver().deleteObject(key);
}

// ─── Signed tokens for the local driver (/api/files/<token>) ───
// The token itself is the authorisation: whoever holds an unexpired token may download that one key.

function signingKey() {
  const secret = process.env.STORAGE_SIGNING_SECRET;
  if (!secret || secret.length < 32) {
    throw new StorageError("STORAGE_SIGNING_SECRET must be set (32+ characters)", { code: "config" });
  }
  return secret;
}

function sign(data) {
  return crypto.createHmac("sha256", signingKey()).update(data).digest("base64url");
}

export function createSignedToken(key, seconds = DEFAULT_URL_SECONDS, { filename } = {}) {
  assertValidKey(key);
  const body = { k: key, e: Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(seconds)) };
  if (filename) body.n = String(filename).slice(0, 200);
  const data = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${data}.${sign(data)}`;
}

/** Returns { key, filename } for a valid, unexpired token; throws StorageError otherwise. */
export function verifySignedToken(token) {
  const secret = signingKey(); // config errors surface as such, not as "invalid link"
  const invalid = () => new StorageError("Invalid or expired link", { code: "invalid_token" });
  if (typeof token !== "string") throw invalid();
  const [data, signature, extra] = token.split(".");
  if (!data || !signature || extra !== undefined) throw invalid();

  const expected = Buffer.from(crypto.createHmac("sha256", secret).update(data).digest("base64url"));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) throw invalid();

  let body;
  try {
    body = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  if (!body || typeof body.e !== "number" || body.e < Math.floor(Date.now() / 1000)) throw invalid();
  assertValidKey(body.k);
  return { key: body.k, filename: body.n || null };
}

export { contentDisposition };
