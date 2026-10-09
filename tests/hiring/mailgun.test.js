// Mailgun sending (libs/mailgun.js): settings from the environment, the message that goes out, readable errors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MailError, defaultFrom, isMailgunConfigured, mailgunSettings, sendEmail } from "../../libs/mailgun";

const ENV = { MAILGUN_API_KEY: "key-secret-value", MAILGUN_DOMAIN: "mg.example.com" };

function fakeClient({ fail = null } = {}) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (domain, data) => {
        calls.push({ domain, data });
        if (fail) throw fail;
        return { id: "<20261009.abc@mg.example.com>", message: "Queued. Thank you." };
      },
    },
  };
}

test("settings: both the key and the domain are needed; the region picks the API address", () => {
  assert.equal(mailgunSettings({}).configured, false);
  assert.deepEqual(mailgunSettings({ MAILGUN_API_KEY: "k" }).missing, ["MAILGUN_DOMAIN"]);
  assert.deepEqual(mailgunSettings({ MAILGUN_DOMAIN: "mg.example.com" }).missing, ["MAILGUN_API_KEY"]);
  assert.equal(isMailgunConfigured(ENV), true);

  assert.equal(mailgunSettings(ENV).url, "https://api.mailgun.net");
  assert.equal(mailgunSettings({ ...ENV, MAILGUN_REGION: "EU" }).url, "https://api.eu.mailgun.net");
  assert.equal(mailgunSettings({ ...ENV, MAILGUN_REGION: "eu", MAILGUN_API_URL: "http://localhost:9999/" }).url, "http://localhost:9999");
});

test("settings: the sender defaults to noreply on the domain, a pasted URL is cleaned, a sandbox is recognised", () => {
  assert.equal(mailgunSettings(ENV).from, "Raasta-AI <noreply@mg.example.com>");
  assert.equal(mailgunSettings({ ...ENV, MAILGUN_FROM: "Acme Hiring <jobs@mg.example.com>" }).from, "Acme Hiring <jobs@mg.example.com>");
  assert.equal(mailgunSettings({ ...ENV, MAILGUN_DOMAIN: "https://mg.example.com/" }).domain, "mg.example.com");
  assert.equal(mailgunSettings({ ...ENV, MAILGUN_DOMAIN: "sandbox0123456789abcdef.mailgun.org" }).sandbox, true);
  assert.equal(mailgunSettings(ENV).sandbox, false);
  assert.equal(defaultFrom(ENV), "Raasta-AI <noreply@mg.example.com>");
});

test("send: the message goes to the configured domain with text, html, reply-to and tracking off", async () => {
  const client = fakeClient();
  const result = await sendEmail({
    to: "sara@example.com",
    subject: "Your AI interview for SRE",
    text: "plain",
    html: "<p>html</p>",
    replyTo: "recruiter@acme.com",
    tags: ["interview-invite", "invite"],
  }, { client, env: ENV });

  assert.deepEqual(result, { id: "<20261009.abc@mg.example.com>", message: "Queued. Thank you." });
  assert.equal(client.calls.length, 1);
  const { domain, data } = client.calls[0];
  assert.equal(domain, "mg.example.com");
  assert.deepEqual(data, {
    from: "Raasta-AI <noreply@mg.example.com>",
    to: ["sara@example.com"],
    subject: "Your AI interview for SRE",
    text: "plain",
    html: "<p>html</p>",
    "h:Reply-To": "recruiter@acme.com",
    "o:tag": ["interview-invite", "invite"],
    "o:tracking": "no",
  });
});

test("send: tracking stays off unless asked (it would rewrite the interview link), a header cannot be injected", async () => {
  const client = fakeClient();
  await sendEmail({ to: "a@b.co", subject: "Hi\r\nBcc: someone@else.com", text: "x" }, { client, env: ENV });
  assert.equal(client.calls[0].data["o:tracking"], "no");
  assert.equal(client.calls[0].data.subject, "Hi Bcc: someone@else.com", "line breaks in a subject are flattened");
  assert.ok(!("h:Reply-To" in client.calls[0].data));
  await sendEmail({ to: "a@b.co", subject: "Hi", text: "x", track: true }, { client, env: ENV });
  assert.equal(client.calls[1].data["o:tracking"], "yes");
});

test("send: MAILGUN_REPLY_TO is the default reply address, a message's own wins", async () => {
  const client = fakeClient();
  const env = { ...ENV, MAILGUN_REPLY_TO: "team@acme.com" };
  await sendEmail({ to: "a@b.co", subject: "Hi", text: "x" }, { client, env });
  await sendEmail({ to: "a@b.co", subject: "Hi", text: "x", replyTo: "me@acme.com" }, { client, env });
  assert.deepEqual(client.calls.map((c) => c.data["h:Reply-To"]), ["team@acme.com", "me@acme.com"]);
});

test("send: refuses before calling Mailgun when it is not configured or the message is unusable", async () => {
  await assert.rejects(sendEmail({ to: "a@b.co", subject: "Hi", text: "x" }, { env: {} }), (error) => {
    assert.ok(error instanceof MailError);
    assert.equal(error.code, "not_configured");
    assert.match(error.message, /MAILGUN_API_KEY and MAILGUN_DOMAIN are not set/);
    return true;
  });
  await assert.rejects(sendEmail({ to: "a@b.co", subject: "Hi", text: "x" }, { env: { MAILGUN_API_KEY: "k" } }), /MAILGUN_DOMAIN is not set/);

  const client = fakeClient();
  for (const bad of [
    { to: "not-an-address", subject: "Hi", text: "x" },
    { to: "", subject: "Hi", text: "x" },
    { to: "a@b.co", subject: " ", text: "x" },
    { to: "a@b.co", subject: "Hi" },
  ]) {
    await assert.rejects(sendEmail(bad, { client, env: ENV }), (error) => error.code === "invalid_message", JSON.stringify(bad));
  }
  assert.equal(client.calls.length, 0);
});

test("errors: Mailgun's refusals say what to fix and never carry the key", async () => {
  const refuse = (status, details) => Object.assign(new Error(details), { status, details });

  const sandbox = { ...ENV, MAILGUN_DOMAIN: "sandbox0123456789abcdef.mailgun.org" };
  await assert.rejects(
    sendEmail({ to: "a@b.co", subject: "Hi", text: "x" }, { client: fakeClient({ fail: refuse(403, "Forbidden") }), env: sandbox }),
    (error) => {
      assert.equal(error.status, 403);
      assert.equal(error.code, "rejected");
      assert.match(error.hint, /sandbox domain.*authorized recipients/);
      return true;
    },
  );
  await assert.rejects(
    sendEmail({ to: "a@b.co", subject: "Hi", text: "x" }, { client: fakeClient({ fail: refuse(401, "Unauthorized") }), env: ENV }),
    (error) => {
      assert.match(error.hint, /MAILGUN_API_KEY.*MAILGUN_REGION/);
      assert.ok(!`${error.message} ${error.hint}`.includes("secret-value"));
      return true;
    },
  );
  await assert.rejects(
    sendEmail({ to: "a@b.co", subject: "Hi", text: "x" }, { client: fakeClient({ fail: refuse(404, "Domain not found") }), env: ENV }),
    (error) => /does not know the domain "mg\.example\.com"/.test(error.hint) && /Domain not found/.test(error.message),
  );
  await assert.rejects(
    sendEmail({ to: "a@b.co", subject: "Hi", text: "x" }, { client: fakeClient({ fail: new Error("getaddrinfo ENOTFOUND api.mailgun.net") }), env: ENV }),
    (error) => error.code === "unreachable" && error.status === null,
  );
});
