// LinkedIn replies (libs/sales/linkedin-inbox.js): the parts that don't need a browser. The shapes
// are from the live messaging page of 9 Oct 2026 (LinkedIn keeps its msg-* markup there).
import { test } from "node:test";
import assert from "node:assert/strict";
import { findConversation, lastIsOurs, newInbound } from "../../libs/sales/linkedin-inbox";

test("the conversation is found by the person's name; a 'You:' preview means nothing new", () => {
  const items = [{ name: "Ali Khan", snippet: "Ali: Sounds good" }, { name: "Nouman  Ahmed", snippet: "You: Hi Nouman, I saw your post…" }];
  assert.equal(findConversation(items, "nouman ahmed"), 1);
  assert.equal(findConversation(items, "Sara"), -1);
  assert.equal(findConversation(items, ""), -1);
  assert.equal(lastIsOurs(items[1]), true);
  assert.equal(lastIsOurs(items[0]), false);
});

test("only the person's messages after our first message count as replies", () => {
  const events = [
    { sender: "Nouman Ahmed", urn: "u0", text: "Old chat from last year" },
    { sender: "Anisa Malik", urn: "u1", text: "Hi Nouman, I saw your post…" },
    { sender: "Nouman Ahmed", urn: "u2", text: "Thanks! What do you charge?" },
    { sender: "Nouman Ahmed", urn: "u3", text: "  " },
    { sender: "Nouman Ahmed", urn: "u4", text: "Also, can we talk Tuesday?" },
  ];
  assert.deepEqual(newInbound(events, "Nouman Ahmed").map((e) => e.urn), ["u2", "u4"]);
  assert.deepEqual(newInbound([{ sender: "Nouman Ahmed", urn: "x", text: "hi" }], "Nouman Ahmed"), [], "we never wrote: nothing is a reply");
});
