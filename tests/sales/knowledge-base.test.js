// Knowledge base (RAG): chunking, embeddings and hybrid search, grounded answers.
// Combined from the section's test files; each keeps its own setup inside its describe block.
// Run: npm run test:sales:knowledge-base   (or: npx tsx --test tests/sales/knowledge-base.test.js)
import "../../libs/load-env"; // first: the database client reads DATABASE_URL when it loads
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import { setLlmClient } from "../../libs/ai/llm";
import { db } from "../../libs/db";
import { answerPrompt, answerQuestion, normaliseSources } from "../../libs/sales/knowledge/answer";
import { KB_CATEGORY_KEYS, normaliseCategory } from "../../libs/sales/knowledge/categories";
import { chunkText, normaliseText } from "../../libs/sales/knowledge/chunk";
import { checkPublicUrl, htmlToText, validateKbFile } from "../../libs/sales/knowledge/extract";
import { SAMPLE_DOCUMENTS } from "../../libs/sales/knowledge/sample";
import { formatContext, fuseRankings, keywordQuery, searchKnowledge } from "../../libs/sales/knowledge/search";
import { addDocument, deleteDocument, knowledgeStats, listDocuments, updateDocument } from "../../libs/sales/knowledge/store";
import { kbChunks } from "../../libs/schema";
import { closeDatabase, createUser, databaseReady, removeUser, resetLlm, useFakeLlm } from "./helpers/fixtures";

// ─── Knowledge base (was knowledge.test.js) ───
describe("Knowledge base", () => {
  after(() => setLlmClient(null));
  const fakeLlm = (content) => ({ chat: { completions: { create: async () => ({ choices: [{ message: { content } }] }) } } });

  test("text is normalised: Windows line ends, no-break spaces, runs of blank lines", () => {
    assert.equal(normaliseText("a\r\nb c  \n\n\n\nd"), "a\nb c\n\nd");
  });

  test("short text is one chunk that carries the title for embedding", () => {
    const [chunk, ...rest] = chunkText("We build mobile apps with Flutter.", { title: "Services" });
    assert.equal(rest.length, 0);
    assert.equal(chunk.content, "We build mobile apps with Flutter.");
    assert.match(chunk.embedText, /^Services\nWe build/);
  });

  test("long text is split under the size limit, and sections keep their heading", () => {
    const section = (name) => `## ${name}\n${Array.from({ length: 12 }, (_, i) => `${name} sentence number ${i} explains a detail.`).join(" ")}`;
    const chunks = chunkText([section("Pricing"), section("Process")].join("\n\n"), { title: "Guide", target: 300, max: 400 });
    assert.ok(chunks.length >= 4);
    for (const c of chunks) assert.ok(c.content.length <= 400 + 130, `chunk too long: ${c.content.length}`);
    assert.ok(chunks.some((c) => c.heading === "Pricing"));
    assert.ok(chunks.some((c) => c.heading === "Process" && c.embedText.startsWith("Guide › Process")));
    assert.deepEqual(chunks.map((c) => c.index), chunks.map((_, i) => i));
  });

  test("a single huge line is hard-split rather than dropped", () => {
    const chunks = chunkText("x".repeat(2500), { max: 1000 });
    assert.equal(chunks.map((c) => c.content).join("").length, 2500);
  });

  test("empty text gives no chunks", () => {
    assert.deepEqual(chunkText("  \n\n "), []);
  });

  test("every sample document chunks into passages the embedding model can read", () => {
    for (const doc of SAMPLE_DOCUMENTS) {
      assert.ok(KB_CATEGORY_KEYS.includes(doc.category), doc.title);
      const chunks = chunkText(doc.content, { title: doc.title });
      assert.ok(chunks.length >= 1);
      for (const c of chunks) assert.ok(c.content.length <= 1200, `${doc.title}: ${c.content.length}`);
    }
  });

  test("rank fusion rewards passages found by both meaning and keywords", () => {
    const fused = fuseRankings([["a", "b", "c"], ["c", "d"]]);
    assert.equal(fused[0].id, "c");
    assert.deepEqual(fused[0].ranks, [3, 1]);
    assert.deepEqual(fused.map((f) => f.id).sort(), ["a", "b", "c", "d"]);
  });

  test("keyword query keeps meaningful words, ORed, without stop words or symbols", () => {
    assert.equal(keywordQuery("How much does a Flutter app cost, and can you sign an NDA?"), "much | flutter | app | cost | sign | nda");
    assert.equal(keywordQuery("the and of"), "");
    assert.equal(keywordQuery("'); drop table x;--"), "drop | table");
  });

  test("context numbers the passages with their titles", () => {
    assert.equal(formatContext([{ title: "Pricing", content: "From $1,500" }, { title: "FAQ", content: "Yes, NDA" }]), "[1] Pricing\nFrom $1,500\n\n---\n\n[2] FAQ\nYes, NDA");
    assert.match(formatContext([]), /nothing/);
  });

  test("html becomes readable text without scripts, menus or tags", () => {
    const text = htmlToText(`<html><head><style>p{}</style><script>alert(1)</script></head><body>
      <nav><a>Home</a></nav><h1>Our Services</h1><p>We build <b>apps</b> &amp; websites.</p>
      <ul><li>Flutter</li><li>React</li></ul><footer>© 2024</footer></body></html>`);
    assert.equal(text, "## Our Services\n\nWe build apps & websites.\n\n- Flutter\n- React");
  });

  test("only public web pages can be fetched", () => {
    assert.ok(checkPublicUrl("https://example.com/services").url);
    for (const bad of ["http://localhost:3000", "http://127.0.0.1/x", "http://192.168.1.4", "http://10.0.0.1", "ftp://example.com", "file:///etc/passwd", "not a url", "http://intranet"]) {
      assert.ok(checkPublicUrl(bad).error, bad);
    }
  });

  test("uploads must be a supported type and size", () => {
    assert.equal(validateKbFile({ filename: "pricing.pdf", size: 1000 }), null);
    assert.equal(validateKbFile({ filename: "notes.md", size: 10 }), null);
    assert.match(validateKbFile({ filename: "photo.png", size: 10 }), /PDF/);
    assert.match(validateKbFile({ filename: "big.pdf", size: 11 * 1024 * 1024 }), /10 MB/);
  });

  test("unknown categories fall back to other", () => {
    assert.equal(normaliseCategory("pricing"), "pricing");
    assert.equal(normaliseCategory("nonsense"), "other");
  });

  test("the answer prompt forbids inventing facts and carries the passages", () => {
    const { system, user } = answerPrompt({ question: "Price?", results: [{ title: "Pricing", content: "From $1,500" }] });
    assert.match(system, /ONLY facts/);
    assert.match(user, /\[1\] Pricing\nFrom \$1,500/);
    assert.match(user, /QUESTION: Price\?/);
  });

  test("source numbers are kept only when they point at a real passage", () => {
    assert.deepEqual(normaliseSources([1, "2", 2, 9, 0, "x"], 3), [1, 2]);
    assert.deepEqual(normaliseSources(null, 3), []);
  });

  test("an answer is covered only when the model says so and cites a passage", async () => {
    const search = async () => ({ results: [{ id: "1", title: "Pricing", content: "Websites from $1,500" }], topSimilarity: 0.6 });
    setLlmClient(fakeLlm(JSON.stringify({ answer: "Websites start at $1,500.", covered: true, sources: [1] })));
    const yes = await answerQuestion({ userId: "u", question: "Website price?" }, { search });
    assert.equal(yes.covered, true);
    assert.deepEqual(yes.sources, [1]);

    setLlmClient(fakeLlm(JSON.stringify({ answer: "I'll check.", covered: true, sources: [] })));
    const noSource = await answerQuestion({ userId: "u", question: "Office dog?" }, { search });
    assert.equal(noSource.covered, false);
  });

  test("an empty knowledge base answers without calling the AI", async () => {
    setLlmClient(fakeLlm("not json"));
    const out = await answerQuestion({ userId: "u", question: "Anything?" }, { search: async () => ({ results: [], topSimilarity: 0 }) });
    assert.equal(out.covered, false);
    assert.match(out.answer, /nothing/);
  });

  test("each FAQ answer gets its own focused passage (found by the retrieval test)", () => {
    const faq = Array.from({ length: 6 }, (_, i) => `Question number ${i} about our service?\nAnswer ${i}: ${"we explain this clearly in a few words. ".repeat(4)}`).join("\n\n");
    const chunks = chunkText(faq, { title: "FAQ" });
    assert.ok(chunks.length >= 3, `expected several passages, got ${chunks.length}`);
    for (const c of chunks) assert.ok(c.content.startsWith("Question number"), "a passage starts at a question");
    assert.ok(chunks.every((c) => c.heading?.endsWith("?")));
  });
});

// ─── Search with the real embedding model and pgvector (was knowledge-search.integration.test.js) ───
// Integration: the knowledge base with the real embedding model and pgvector. The sample company
// profile is indexed, then the questions from the manual test are asked: each must find the right
// passage, and a question the knowledge base can't answer must come back as weak / not covered.
// (The first run downloads the embedding model, ~90 MB, into .cache/models.)
describe("Search with the real embedding model and pgvector", () => {
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
});

// One database connection for the whole file: closed after every section has run
after(async () => {
  await closeDatabase();
});
