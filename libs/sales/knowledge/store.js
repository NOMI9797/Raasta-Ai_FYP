// Knowledge base documents: add, edit, remove, and (re)index them into embedded chunks.
// Relative imports only (the agent reads the knowledge base from the worker).
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { kbChunks, kbDocuments } from "../../schema";
import { normaliseCategory } from "./categories";
import { chunkText, normaliseText } from "./chunk";
import { embedTexts } from "./embed";
import { MAX_KB_TEXT } from "./extract";

export class KnowledgeError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "KnowledgeError";
    this.status = status;
  }
}

function cleanInput({ title, content, category }) {
  const t = String(title || "").trim().slice(0, 200);
  const c = normaliseText(content).slice(0, MAX_KB_TEXT);
  if (!t) throw new KnowledgeError("Give it a title");
  if (c.length < 20) throw new KnowledgeError("Write at least a sentence or two");
  return { title: t, content: c, category: normaliseCategory(category) };
}

/** Split, embed and store a document's chunks, replacing any it had. Marks it failed on error. */
export async function indexDocument(doc, { database = db } = {}) {
  try {
    const chunks = chunkText(doc.content, { title: doc.title });
    const vectors = await embedTexts(chunks.map((c) => c.embedText));
    await database.transaction(async (tx) => {
      await tx.delete(kbChunks).where(eq(kbChunks.documentId, doc.id));
      if (chunks.length) {
        await tx.insert(kbChunks).values(chunks.map((c, i) => ({
          documentId: doc.id,
          userId: doc.userId,
          chunkIndex: c.index,
          content: c.content,
          embedding: vectors[i],
        })));
      }
      await tx.update(kbDocuments).set({ chunkCount: chunks.length, status: "ready", error: null, updatedAt: new Date() }).where(eq(kbDocuments.id, doc.id));
    });
    return { ...doc, chunkCount: chunks.length, status: "ready", error: null };
  } catch (error) {
    console.error("Knowledge base indexing failed:", error?.message);
    await database.update(kbDocuments).set({ status: "failed", error: String(error?.message || error).slice(0, 500), updatedAt: new Date() }).where(eq(kbDocuments.id, doc.id));
    throw new KnowledgeError(`Saved, but it couldn't be made searchable: ${error?.message || "unknown error"}`, 500);
  }
}

export async function addDocument({ userId, title, content, category, kind = "note", source = null, isSample = false }, { database = db } = {}) {
  const input = cleanInput({ title, content, category });
  const [doc] = await database.insert(kbDocuments).values({
    userId, ...input, kind, source, isSample, status: "ready",
  }).returning();
  return indexDocument(doc, { database });
}

export async function getDocument(id, userId, { database = db } = {}) {
  const [doc] = await database.select().from(kbDocuments).where(and(eq(kbDocuments.id, id), eq(kbDocuments.userId, userId))).limit(1);
  if (!doc) throw new KnowledgeError("Not found", 404);
  return doc;
}

export async function updateDocument(id, userId, patch, { database = db } = {}) {
  const doc = await getDocument(id, userId, { database });
  const input = cleanInput({
    title: patch.title ?? doc.title,
    content: patch.content ?? doc.content,
    category: patch.category ?? doc.category,
  });
  const [updated] = await database.update(kbDocuments).set({ ...input, isSample: false, updatedAt: new Date() }).where(eq(kbDocuments.id, id)).returning();
  // Re-embed only when the searchable text changed
  if (input.title !== doc.title || input.content !== doc.content || doc.status !== "ready") return indexDocument(updated, { database });
  return updated;
}

export async function deleteDocument(id, userId, { database = db } = {}) {
  await getDocument(id, userId, { database });
  await database.delete(kbDocuments).where(eq(kbDocuments.id, id));
}

export async function listDocuments(userId, { database = db } = {}) {
  return database.select().from(kbDocuments).where(eq(kbDocuments.userId, userId)).orderBy(asc(kbDocuments.category), desc(kbDocuments.updatedAt));
}

export async function knowledgeStats(userId, { database = db } = {}) {
  const [row] = await database.select({
    documents: sql`count(*)::int`,
    chunks: sql`coalesce(sum(${kbDocuments.chunkCount}), 0)::int`,
    samples: sql`count(*) filter (where ${kbDocuments.isSample})::int`,
  }).from(kbDocuments).where(eq(kbDocuments.userId, userId));
  return row || { documents: 0, chunks: 0, samples: 0 };
}
