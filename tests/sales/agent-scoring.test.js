import { test, after } from "node:test";
import assert from "node:assert/strict";
import { setLlmClient } from "../../libs/ai/llm";
import { normaliseScore, scoreLead, scorePrompt } from "../../libs/sales/agent/scoring";

after(() => setLlmClient(null));

const fakeLlm = (content) => ({ chat: { completions: { create: async () => ({ choices: [{ message: { content } }] }) } } });

test("the prompt for a company carries its roles, size, website text and the offer", () => {
  const { user } = scorePrompt({
    lead: {
      source: "indeed",
      company: "Acme",
      sourceData: {
        jobs: [{ title: "React Developer" }, { title: "QA" }],
        company: { employees: "51 to 200", industry: "Software" },
        research: { description: "Fintech apps", emails: ["hr@acme.pk"] },
      },
    },
    campaign: { icpConfig: { serviceType: "Staff augmentation" } },
  });
  assert.match(user, /What we sell: Staff augmentation/);
  assert.match(user, /Open roles: React Developer; QA/);
  assert.match(user, /Size: 51 to 200 staff/);
  assert.match(user, /Contact found: an email address/);
});

test("scores are clamped to 0-100 and a missing score is an error", () => {
  assert.deepEqual(normaliseScore({ score: 140, reason: "great" }), { score: 100, reason: "great" });
  assert.equal(normaliseScore({ score: "72.4" }).score, 72);
  assert.throws(() => normaliseScore({ reason: "x" }), /score/);
});

test("scoreLead reads the model's JSON", async () => {
  setLlmClient(fakeLlm('{"score": 81, "reason": "Hiring three React developers; we place React engineers."}'));
  const fit = await scoreLead({ lead: { source: "indeed", company: "Acme", sourceData: {} }, campaign: {} });
  assert.equal(fit.score, 81);
  assert.match(fit.reason, /React/);
  assert.ok(fit.scoredAt);
});
