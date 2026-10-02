import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { APIError, RateLimitError } from "openai";
import { chatJSON, chatText, parseJsonContent, setLlmClient, LlmError } from "../../libs/ai/llm";

// Fake OpenAI client: returns queued responses (strings or errors) and records requests
function fakeClient(responses) {
  const calls = [];
  return {
    calls,
    chat: {
      completions: {
        async create(request) {
          calls.push(request);
          const next = responses.shift();
          if (next instanceof Error) throw next;
          return { choices: [{ message: { content: next } }] };
        },
      },
    },
  };
}

afterEach(() => setLlmClient(null));

test("parseJsonContent strips fences and surrounding text", () => {
  assert.deepEqual(parseJsonContent('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonContent('Here you go: {"a":2} thanks'), { a: 2 });
  assert.equal(parseJsonContent("not json"), undefined);
  assert.equal(parseJsonContent("null"), undefined);
  assert.equal(parseJsonContent("42"), undefined);
});

test("chatJSON requests JSON mode and parses the reply", async () => {
  const client = fakeClient(['{"score": 80}']);
  setLlmClient(client);
  const result = await chatJSON({ system: "sys", user: "hi", schemaHint: '{"score": number}' });
  assert.deepEqual(result, { score: 80 });
  assert.deepEqual(client.calls[0].response_format, { type: "json_object" });
  assert.match(client.calls[0].messages[0].content, /score": number/);
});

test("chatJSON retries once with a stricter instruction", async () => {
  const client = fakeClient(["oops not json", '{"ok":true}']);
  setLlmClient(client);
  assert.deepEqual(await chatJSON({ user: "hi" }), { ok: true });
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[1].messages.at(-1).content, "Return ONLY valid JSON.");
});

test("chatJSON throws a parse LlmError after two bad replies", async () => {
  setLlmClient(fakeClient(["bad", "still bad"]));
  await assert.rejects(chatJSON({ user: "hi" }), (e) => e instanceof LlmError && e.code === "parse");
});

test("Groq json_validate_failed counts as unparseable output and is retried", async () => {
  const validationError = new APIError(400, { code: "json_validate_failed" }, "Failed to generate JSON", new Headers());
  const client = fakeClient([validationError, '{"ok":1}']);
  setLlmClient(client);
  assert.deepEqual(await chatJSON({ user: "hi" }), { ok: 1 });
});

test("429 becomes a rate_limit LlmError with retryAfterMs", async () => {
  const limited = new RateLimitError(429, {}, "slow down", new Headers({ "retry-after": "7" }));
  setLlmClient(fakeClient([limited]));
  await assert.rejects(chatText({ user: "hi" }), (e) => e.code === "rate_limit" && e.retryAfterMs === 7000);
});

test("other failures become upstream LlmErrors", async () => {
  setLlmClient(fakeClient([new Error("socket hang up")]));
  await assert.rejects(chatJSON({ user: "hi" }), (e) => e instanceof LlmError && e.code === "upstream");
});

test("chatText returns trimmed text and accepts a messages array", async () => {
  const client = fakeClient(["  hello  "]);
  setLlmClient(client);
  const text = await chatText({ system: "s", messages: [{ role: "user", content: "x" }] });
  assert.equal(text, "hello");
  assert.deepEqual(client.calls[0].messages.map((m) => m.role), ["system", "user"]);
});
