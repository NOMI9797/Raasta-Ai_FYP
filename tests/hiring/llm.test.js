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

// Reasoning models spend max_tokens on thinking: a small budget gave an empty or cut-off reply
function replyingClient(replies) {
  const calls = [];
  return {
    calls,
    chat: { completions: { async create(request) { calls.push(request); const next = replies.shift(); return { choices: [{ message: { content: next.content }, finish_reason: next.finish }] }; } } },
  };
}

test("a reply cut off by the token limit is asked again with a bigger budget", async () => {
  const client = replyingClient([{ content: "", finish: "length" }, { content: "Could you describe the project?", finish: "stop" }]);
  setLlmClient(client);
  assert.equal(await chatText({ user: "hi", model: "openai/gpt-oss-120b", maxTokens: 150 }), "Could you describe the project?");
  assert.deepEqual(client.calls.map((c) => c.max_tokens), [150, 450]);
});

test("the budget is only raised once", async () => {
  const client = replyingClient([{ content: "Cut", finish: "length" }, { content: "Cut again", finish: "length" }]);
  setLlmClient(client);
  assert.equal(await chatText({ user: "hi", maxTokens: 100 }), "Cut again");
  assert.equal(client.calls.length, 2);
});

test("reasoning effort is sent to GPT-OSS models only", async () => {
  const client = replyingClient([{ content: "a", finish: "stop" }, { content: "b", finish: "stop" }, { content: "c", finish: "stop" }]);
  setLlmClient(client);
  await chatText({ user: "hi", model: "openai/gpt-oss-20b", reasoningEffort: "low" });
  await chatText({ user: "hi", model: "llama-3.3-70b-versatile", reasoningEffort: "low" });
  await chatText({ user: "hi", model: "openai/gpt-oss-20b" });
  assert.equal(client.calls[0].reasoning_effort, "low");
  assert.equal("reasoning_effort" in client.calls[1], false);
  assert.equal("reasoning_effort" in client.calls[2], false);
});
