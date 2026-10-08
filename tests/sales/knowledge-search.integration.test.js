import "../../libs/load-env"; // first: the database client reads DATABASE_URL when it loads
// Integration: the knowledge base with the real embedding model and pgvector. The sample company
// profile is indexed, then the questions from the manual test are asked: each must find the right
// passage, and a question the knowledge base can't answer must come back as weak / not covered.
// (The first run downloads the embedding model, ~90 MB, into .cache/models.)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../../libs/db";
import { kbChunks } from "../../libs/schema";
import { addDocument, deleteDocument, knowledgeStats, listDocuments, updateDocument } from "../../libs/sales/knowledge/store";
import { searchKnowledge } from "../../libs/sales/knowledge/search";
import { answerQuestion } from "../../libs/sales/knowledge/answer";
import { SAMPLE_DOCUMENTS } from "../../libs/sales/knowledge/sample";
import { closeDatabase, createUser, databaseReady, removeUser, resetLlm, useFakeLlm } from "./helpers/fixtures";

let ready = false;
let user;
before(async () => {
  ready = await databaseReady();
  if (!ready) return;
  user = await createUser();
  for (const doc of SAMPLE_DOCUMENTS) await addDocument({ userId: user.id, ...doc, isSample: true });
});
after(async () => {
  resetLlm();
  if (user) await removeUser(user.id);
  await closeDatabase();
});

test("the sample company profile is split, embedded and stored", { timeout: 300000 }, async (t) => {
  if (!ready) return t.skip("database not reachable");
  const stats = await knowledgeStats(user.id);
  assert.equal(stats.documents, SAMPLE_DOCUMENTS.length);
  assert.ok(stats.chunks >= SAMPLE_DOCUMENTS.length);
  assert.equal(stats.samples, SAMPLE_DOCUMENTS.length);
  const docs = await listDocuments(user.id);
  assert.ok(docs.every((d) => d.status === "ready" && d.chunkCount > 0));
});

// Question → the document its best passage must come from. The first three are the manual test's
// questions, which matched closely (similarity 0.76, 0.56, 0.54); `close` checks that too.
// Similarity alone can't tell "weak" from "not covered" (0.24 vs 0.23), so the AI decides coverage.
const QUESTIONS = [
  ["How much would a senior React developer cost per month?", "Pricing", { close: true }],
  ["Can you sign an NDA before we talk?", "Frequently asked questions", { close: true }],
  ["Do you have experience with logistics apps?", "Case studies", { close: true }],
  ["Do you build iOS and Android apps?", "Our services"],
  ["How long does it take to build an MVP?", "How we work"],
  ["Where is your office and when were you founded?", "About us and contact"],
  ["What happens if a developer isn't a good fit?", "Frequently asked questions"],
];

for (const [question, title, { close = false } = {}] of QUESTIONS) {
  test(`finds "${title}" for: ${question}`, { timeout: 120000 }, async (t) => {
    if (!ready) return t.skip("database not reachable");
    const { results, topSimilarity } = await searchKnowledge({ userId: user.id, query: question, limit: 5 });
    assert.equal(results[0]?.title, title, `top passages: ${results.map((r) => `${r.title} (${r.similarity})`).join(", ")}`);
    if (close) assert.ok(topSimilarity >= 0.35, `close match expected, got ${topSimilarity}`);
  });
}

test("a question the knowledge base doesn't cover only finds weak matches", async (t) => {
  if (!ready) return t.skip("database not reachable");
  const { topSimilarity } = await searchKnowledge({ userId: user.id, query: "Do you offer blockchain smart contract audits?", limit: 5 });
  assert.ok(topSimilarity < 0.35, `weak match expected, got ${topSimilarity}`);
});

test("keyword search catches exact terms: Flutter", async (t) => {
  if (!ready) return t.skip("database not reachable");
  const { results } = await searchKnowledge({ userId: user.id, query: "Flutter", limit: 5 });
  assert.ok(results.length > 0);
  assert.ok(results.every((r) => /flutter/i.test(r.content) || r.similarity >= 0.2));
  assert.ok(results.some((r) => r.keyword), "found by keyword too");
});

test("one user's knowledge base is never searched for another user", async (t) => {
  if (!ready) return t.skip("database not reachable");
  const other = await createUser();
  try {
    const { results } = await searchKnowledge({ userId: other.id, query: "How much does a senior developer cost?", limit: 5 });
    assert.equal(results.length, 0);
  } finally {
    await removeUser(other.id);
  }
});

test("editing an entry re-indexes it; deleting removes its passages", async (t) => {
  if (!ready) return t.skip("database not reachable");
  const doc = await addDocument({ userId: user.id, title: "Office pets", category: "other", content: "Our office has a friendly cat called Biscuit who attends every stand-up meeting." });
  let { results } = await searchKnowledge({ userId: user.id, query: "Do you have a cat in the office?", limit: 3 });
  assert.equal(results[0].title, "Office pets");

  await updateDocument(doc.id, user.id, { content: "Our office has a parrot called Mango who greets every visitor at the door." });
  ({ results } = await searchKnowledge({ userId: user.id, query: "Is there a parrot at your office?", limit: 3 }));
  assert.equal(results[0].title, "Office pets");
  assert.match(results[0].content, /parrot/);

  await deleteDocument(doc.id, user.id);
  const left = await db.select().from(kbChunks).where(eq(kbChunks.documentId, doc.id));
  assert.equal(left.length, 0);
});

test("the answer comes only from the passages found, with the ones it used", async (t) => {
  if (!ready) return t.skip("database not reachable");
  const calls = useFakeLlm([{ when: () => true, reply: () => ({ answer: "A senior developer is from $4,000 per month.", covered: true, sources: [1] }) }]);
  const out = await answerQuestion({ userId: user.id, question: "How much is a senior developer per month?" });
  assert.equal(out.covered, true);
  assert.deepEqual(out.sources, [1]);
  assert.equal(out.passages[0].title, "Pricing");
  assert.match(calls[0].user, /\[1\] Pricing\n[\s\S]*\$4,000 per month/, "the AI is given the pricing passage");
  assert.match(calls[0].system, /ONLY facts/);
});
