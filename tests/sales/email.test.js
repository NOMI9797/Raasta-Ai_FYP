import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { renderEmail, sendSalesEmail } from "../../libs/sales/send/email";

const fakeTransport = () => {
  const sent = [];
  return { sent, sendMail: async (mail) => (sent.push(mail), { messageId: "<fake@test>" }) };
};

beforeEach(() => {
  delete process.env.SALES_EMAIL_TEST_RECIPIENT;
  process.env.SENDER_EMAIL = "sender@example.com";
});

test("sends to the real recipient when no test address is set", async () => {
  const transport = fakeTransport();
  const out = await sendSalesEmail({ to: "hr@acme.pk", subject: "Hello", body: "Hi team,\n\nLine two", senderName: "Nouman Ahmed" }, { transport });
  assert.equal(out.to, "hr@acme.pk");
  assert.equal(out.redirected, false);
  assert.equal(transport.sent[0].to, "hr@acme.pk");
  assert.equal(transport.sent[0].subject, "Hello");
  assert.equal(transport.sent[0].from, '"Nouman Ahmed" <sender@example.com>');
});

test("redirects to the test address, marks the subject and names the intended recipient", async () => {
  process.env.SALES_EMAIL_TEST_RECIPIENT = "me@test.dev";
  const transport = fakeTransport();
  const out = await sendSalesEmail({ to: "hr@acme.pk", subject: "Hello", body: "Hi" }, { transport });
  assert.deepEqual([out.to, out.intendedTo, out.redirected], ["me@test.dev", "hr@acme.pk", true]);
  assert.equal(transport.sent[0].to, "me@test.dev");
  assert.equal(transport.sent[0].subject, "[TEST] Hello");
  assert.match(transport.sent[0].text, /would have gone to hr@acme\.pk/);
});

test("refuses invalid addresses and empty bodies", async () => {
  const transport = fakeTransport();
  await assert.rejects(sendSalesEmail({ to: "not-an-email", subject: "x", body: "x" }, { transport }), /valid email/);
  await assert.rejects(sendSalesEmail({ to: "a@b.co", subject: "x", body: "  " }, { transport }), /empty/);
  assert.equal(transport.sent.length, 0);
});

test("renderEmail escapes HTML and keeps paragraphs", () => {
  const { html, text } = renderEmail({ body: "Hi <b>team</b>\n\nSecond" });
  assert.match(html, /Hi &lt;b&gt;team&lt;\/b&gt;/);
  assert.equal((html.match(/<p /g) || []).length, 2);
  assert.equal(text, "Hi <b>team</b>\n\nSecond");
});
