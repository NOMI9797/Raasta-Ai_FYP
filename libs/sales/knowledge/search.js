// Retrieval for the knowledge base: hybrid search. Meaning (pgvector cosine similarity) finds
// "how much does it cost" → "Pricing: packages start at…"; keywords (Postgres full-text search)
// catch exact names like "Flutter" or "NDA" that embeddings blur. The two rankings are merged
// with reciprocal rank fusion. Relative imports only.
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { embedText, toVectorLiteral } from "./embed";

const CANDIDATES = 20;      // from each side, before fusion
const RRF_K = 60;           // standard reciprocal rank fusion constant
export const MIN_SIMILARITY = 0.2; // below this, a passage only counts if its keywords matched

/** Merge ranked id lists: score = Σ 1 / (k + rank). Pure; unit-tested. */
export function fuseRankings(lists, { k = RRF_K } = {}) {
  const scores = new Map();
  lists.forEach((list, which) => {
    list.forEach((id, rank) => {
      const entry = scores.get(id) || { id, score: 0, ranks: [] };
      entry.score += 1 / (k + rank + 1);
      entry.ranks[which] = rank + 1;
      scores.set(id, entry);
    });
  });
  return [...scores.values()].sort((a, b) => b.score - a.score);
}

const STOP = new Set("the and for are you your our can with what how does that this have will from about any there they them their which when who why would could should into also just more than then been were was has had not but all its it's ive i'm we're".split(" "));

/** OR-query of the meaningful words, so one matching term is enough: 'flutter | price | app'. */
export function keywordQuery(text) {
  const words = String(text || "").toLowerCase().match(/[a-z0-9][a-z0-9+#.-]*[a-z0-9+#]|[a-z0-9]/g) || [];
  const keep = [...new Set(words.filter((w) => w.length > 2 && !STOP.has(w)))].slice(0, 20);
  return keep.map((w) => w.replace(/[^a-z0-9]/g, "")).filter(Boolean).join(" | ");
}

/**
 * Passages of this user's knowledge base that answer `query`, best first:
 * [{ id, documentId, title, category, content, similarity, keyword }]. `topSimilarity` tells how
 * close the best meaning-match was (0..1), so callers can tell "not in the knowledge base".
 */
export async function searchKnowledge({ userId, query, limit = 5 }, { database = db, embed = embedText } = {}) {
  const q = String(query || "").trim().slice(0, 2000);
  if (!q) return { results: [], topSimilarity: 0 };
  const vector = toVectorLiteral(await embed(q));
  const words = keywordQuery(q);

  const [byMeaning, byWords] = await Promise.all([
    database.execute(sql`
      select c.id, c.document_id, c.content, c.chunk_index, d.title, d.category,
             1 - (c.embedding <=> ${vector}::vector) as similarity
      from kb_chunks c join kb_documents d on d.id = c.document_id
      where c.user_id = ${userId}
      order by c.embedding <=> ${vector}::vector
      limit ${CANDIDATES}`),
    words
      ? database.execute(sql`
          select c.id, c.document_id, c.content, c.chunk_index, d.title, d.category,
                 1 - (c.embedding <=> ${vector}::vector) as similarity
          from kb_chunks c join kb_documents d on d.id = c.document_id
          where c.user_id = ${userId} and c.tsv @@ to_tsquery('english', ${words})
          order by ts_rank(c.tsv, to_tsquery('english', ${words})) desc
          limit ${CANDIDATES}`)
      : [],
  ]);

  const rows = new Map();
  for (const r of [...byMeaning, ...byWords]) rows.set(r.id, r);
  const keywordIds = new Set(byWords.map((r) => r.id));
  const meaningIds = byMeaning.filter((r) => Number(r.similarity) >= MIN_SIMILARITY || keywordIds.has(r.id)).map((r) => r.id);

  const fused = fuseRankings([meaningIds, byWords.map((r) => r.id)]);
  const results = fused.slice(0, limit).map(({ id, score }) => {
    const r = rows.get(id);
    return {
      id,
      documentId: r.document_id,
      title: r.title,
      category: r.category,
      content: r.content,
      similarity: Math.round(Number(r.similarity) * 1000) / 1000,
      keyword: keywordIds.has(id),
      score,
    };
  });
  const topSimilarity = byMeaning.length ? Math.round(Number(byMeaning[0].similarity) * 1000) / 1000 : 0;
  return { results, topSimilarity };
}

/** Passages as numbered context for a prompt: "[1] Pricing › Web packages\n…". */
export function formatContext(results) {
  if (!results.length) return "(The knowledge base has nothing on this.)";
  return results.map((r, i) => `[${i + 1}] ${r.title}\n${r.content}`).join("\n\n---\n\n");
}
