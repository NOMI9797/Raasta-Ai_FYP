// Text embeddings for the knowledge base, computed locally (no API key, nothing leaves the machine).
// The model (all-MiniLM-L6-v2, 384 numbers per text, ~90 MB) downloads once into .cache/models.
// Relative imports only (runs in the worker).
import path from "path";

export const EMBED_DIMENSIONS = 384;
export const EMBED_MODEL = process.env.KB_EMBED_MODEL || "Xenova/all-MiniLM-L6-v2";
const BATCH = 16;

let extractorPromise = null;
let override = null;

/** Tests swap in a fake: fn(texts) => number[][] */
export function setEmbedder(fn) {
  override = fn;
}

async function extractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = process.env.KB_MODEL_CACHE || path.join(process.cwd(), ".cache", "models");
      return pipeline("feature-extraction", EMBED_MODEL, { dtype: "fp32" });
    })().catch((error) => {
      extractorPromise = null; // try again next time (e.g. the download was interrupted)
      throw error;
    });
  }
  return extractorPromise;
}

/** One normalised vector per text, in order. Cosine similarity is then a dot product. */
export async function embedTexts(texts) {
  if (!texts.length) return [];
  if (override) return override(texts);
  const fe = await extractor();
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const tensor = await fe(texts.slice(i, i + BATCH), { pooling: "mean", normalize: true });
    out.push(...tensor.tolist());
  }
  return out;
}

export async function embedText(text) {
  return (await embedTexts([text]))[0];
}

/** pgvector literal: '[0.1,0.2,...]' */
export function toVectorLiteral(vector) {
  return `[${vector.map((x) => (Number.isFinite(x) ? x : 0)).join(",")}]`;
}
