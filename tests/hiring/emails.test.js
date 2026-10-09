// Invite / reminder / outcome emails and the dev outbox (docs/ai-hiring/08-invitations.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { deliverEmail, formatExpiry, inviteEmail, outcomeEmail, relativeExpiry, reminderEmail, usesDevOutbox } from "../../libs/hiring/emails";

const VARS = {
  candidateName: "Sara Malik",
  jobTitle: "Platform <Engineer>",
  link: "http://localhost:8085/interview/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
  expiresAt: new Date("2026-10-10T14:30:00Z"),
  maxMinutes: 25,
  recordVideo: true,
  hiringTeam: "Acme Hiring",
};

test("invite: subject, link, expiry with timezone, requirements and privacy note", () => {
  const { subject, text, html } = inviteEmail(VARS);
  assert.equal(subject, "Your AI interview for Platform <Engineer>");
  for (const body of [text, html]) {
    assert.ok(body.includes(VARS.link), "contains the interview link");
    assert.match(body, /Saturday, 10 October 2026(,| at) 14:30 UTC/);
    assert.match(body, /Raasta AI Interviewer/);
    assert.match(body, /Chrome or Edge/);
    assert.match(body, /microphone and camera/);
    assert.match(body, /audio and video/);
    assert.match(body, /up to 25 minutes/);
    assert.match(body, /English only/);
  }
  assert.match(html, /Start my interview/);
  assert.match(html, /If the button doesn't work/);
  assert.ok(html.includes("Platform &lt;Engineer&gt;"), "job title is escaped in HTML");
  assert.ok(!html.includes("<Engineer>"));
});

test("invite without video asks only for a microphone", () => {
  const { text } = inviteEmail({ ...VARS, recordVideo: false, hiringTeam: null });
  assert.match(text, /a working microphone\n/);
  assert.match(text, /recorded \(audio\)/);
  assert.match(text, /the hiring team/);
});

test("reminder: relative expiry in the subject and a replacement-link note", () => {
  const now = new Date("2026-10-09T14:30:00Z");
  const { subject, text, html } = reminderEmail(VARS, now);
  assert.equal(subject, "Reminder: your AI interview for Platform <Engineer> expires in 24 hours");
  assert.match(text, /replaces the one in our earlier email/);
  assert.ok(html.includes(VARS.link));
  assert.equal(relativeExpiry(new Date(now.getTime() + 30 * 60000), now), "within the hour");
  assert.equal(relativeExpiry(new Date(now.getTime() + 72 * 3600000), now), "in 3 days");
});

test("emails never mention scores", () => {
  const all = [inviteEmail(VARS), reminderEmail(VARS), outcomeEmail({ outcome: "final_rejected", ...VARS }), outcomeEmail({ outcome: "final_shortlisted", ...VARS })];
  for (const { subject, text, html } of all) {
    assert.ok(!/score|%|points|rating/i.test(`${subject} ${text} ${html.replace(/width:\d+%|100%/g, "")}`));
  }
  assert.match(outcomeEmail({ outcome: "final_shortlisted", ...VARS }).subject, /next round/);
  assert.match(outcomeEmail({ outcome: "not_shortlisted", ...VARS }).text, /not to move forward/);
});

test("formatExpiry honours a configured timezone", () => {
  assert.match(formatExpiry("2026-10-10T14:30:00Z", "Asia/Karachi"), /19:30 \(Asia\/Karachi\)$/);
});

test("deliverEmail: dev outbox without a Mailgun key, never logs the link", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "outbox-"));
  const saved = { key: process.env.MAILGUN_API_KEY, dir: process.env.STORAGE_LOCAL_DIR, env: process.env.NODE_ENV };
  delete process.env.MAILGUN_API_KEY;
  process.env.STORAGE_LOCAL_DIR = dir;
  process.env.NODE_ENV = "test";
  const logged = [];
  const originals = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...args) => logged.push(args.join(" "));
  try {
    const message = inviteEmail(VARS);
    const result = await deliverEmail({ to: "sara@example.com", ...message });
    assert.equal(result.delivered, "outbox");
    const files = fs.readdirSync(path.join(dir, "outbox"));
    assert.equal(files.length, 2);
    const html = fs.readFileSync(path.join(dir, "outbox", result.file), "utf8");
    assert.ok(html.includes(VARS.link));
    assert.ok(!logged.join("\n").includes(VARS.link), "the link is never logged");

    process.env.NODE_ENV = "production";
    await assert.rejects(deliverEmail({ to: "a@b.c", ...message }), /MAILGUN_API_KEY/);

    const sent = [];
    const custom = await deliverEmail({ to: "a@b.c", ...message }, { send: async (m) => sent.push(m) });
    assert.equal(custom.delivered, "custom");
    assert.match(sent[0].from, /noreply/);
  } finally {
    Object.assign(console, originals);
    if (saved.key) process.env.MAILGUN_API_KEY = saved.key;
    process.env.STORAGE_LOCAL_DIR = saved.dir ?? "";
    if (!saved.dir) delete process.env.STORAGE_LOCAL_DIR;
    process.env.NODE_ENV = saved.env ?? "";
    if (!saved.env) delete process.env.NODE_ENV;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("usesDevOutbox: production needs EMAIL_OUTBOX=local to keep the outbox; a Mailgun key always wins", () => {
  const saved = { key: process.env.MAILGUN_API_KEY, env: process.env.NODE_ENV, outbox: process.env.EMAIL_OUTBOX };
  try {
    delete process.env.MAILGUN_API_KEY;
    delete process.env.EMAIL_OUTBOX;
    process.env.NODE_ENV = "production";
    assert.equal(usesDevOutbox(), false);
    process.env.EMAIL_OUTBOX = "local";
    assert.equal(usesDevOutbox(), true);
    process.env.MAILGUN_API_KEY = "key-123";
    assert.equal(usesDevOutbox(), false, "with a key the email is really sent");
    delete process.env.EMAIL_OUTBOX;
    process.env.NODE_ENV = "development";
    delete process.env.MAILGUN_API_KEY;
    assert.equal(usesDevOutbox(), true);
  } finally {
    for (const [name, value] of [["MAILGUN_API_KEY", saved.key], ["NODE_ENV", saved.env], ["EMAIL_OUTBOX", saved.outbox]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

// ───────────────────────────── layout ─────────────────────────────

test("invite layout: details first, then the button, requirements and steps; English only is stated", () => {
  const { text, html } = inviteEmail({ ...VARS, canReply: true });

  // Plain text reads in sections
  const order = ["INTERVIEW DETAILS", "START YOUR INTERVIEW", "BEFORE YOU START", "HOW IT WORKS", "Privacy:", "Good luck!"].map((h) => text.indexOf(h));
  assert.ok(order.every((i) => i >= 0), "every section is there");
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "in a sensible order");
  assert.match(text, /Language:\s+English only/);
  assert.match(text, /Length:\s+up to 25 minutes/);
  assert.match(text, /Complete by:\s+Saturday, 10 October 2026(,| at) 14:30 UTC/);
  assert.match(text, /Questions\? Just reply to this email\./);

  // HTML is a table layout with the details box before the button
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<table role="presentation"/);
  assert.ok(html.indexOf("Complete by") < html.indexOf("Start my interview"));
  assert.ok(html.indexOf("Start my interview") < html.indexOf("Before you start"));
  assert.match(html, /<ol /);
  assert.match(html, /Questions\? Just reply to this email\./);
  assert.match(html, /display:none[^>]*>You(&#39;|')ve been shortlisted for Platform &lt;Engineer&gt;\./, "a preheader for the inbox preview");
  assert.ok(!/<script|javascript:/i.test(html));
});

test("invite footer promises a reply only when replies reach someone", () => {
  const withReply = inviteEmail({ ...VARS, canReply: true });
  const without = inviteEmail(VARS);
  assert.match(withReply.html, /Just reply to this email/);
  assert.ok(!/reply to this email/i.test(without.text.replace(/replaces the one in our earlier email/, "")));
  assert.ok(!/Just reply/.test(without.html));
});

test("reminder: a notice above the content, and the link of the invite", () => {
  const now = new Date("2026-10-09T14:30:00Z");
  const { text, html } = reminderEmail(VARS, now);
  assert.ok(text.startsWith("This is a reminder: your interview link expires in 24 hours."));
  assert.ok(html.indexOf("This is a reminder") < html.indexOf("Your interview for"));
  assert.ok(html.includes(VARS.link));
});

test("outcome emails: a heading, the team, a footer, and a decline is kind and short", () => {
  const no = outcomeEmail({ outcome: "final_rejected", ...VARS });
  assert.match(no.html, /An update on your application/);
  assert.match(no.text, /Acme Hiring has decided not to move forward/);
  assert.match(no.text, /Acme Hiring via Raasta-AI/);
  const yes = outcomeEmail({ outcome: "final_shortlisted", ...VARS, canReply: true });
  assert.match(yes.html, /You(&#39;|')ve moved to the next round/);
  assert.match(yes.text, /Questions\? Just reply/);
});

// ───────────────────────────── delivery through Mailgun ─────────────────────────────

function withEnv(values, fn) {
  const saved = {};
  for (const key of Object.keys(values)) saved[key] = process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  return Promise.resolve(fn()).finally(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

test("deliverEmail: with a key and a domain the email goes through Mailgun, from the configured sender, replies to the recruiter", async () => {
  const calls = [];
  const client = { messages: { create: async (domain, data) => { calls.push({ domain, data }); return { id: "<id@mg.example.com>", message: "Queued." }; } } };
  await withEnv({ MAILGUN_API_KEY: "key-1", MAILGUN_DOMAIN: "mg.example.com", MAILGUN_FROM: undefined, NODE_ENV: "production" }, async () => {
    const message = inviteEmail(VARS);
    const result = await deliverEmail({ to: "sara@example.com", replyTo: "recruiter@acme.com", tags: ["interview-invite"], ...message }, { client });
    assert.deepEqual(result, { delivered: "mailgun", id: "<id@mg.example.com>" });
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].domain, "mg.example.com");
  assert.equal(calls[0].data.from, "Raasta-AI <noreply@mg.example.com>");
  assert.deepEqual(calls[0].data.to, ["sara@example.com"]);
  assert.equal(calls[0].data["h:Reply-To"], "recruiter@acme.com");
  assert.equal(calls[0].data["o:tracking"], "no");
  assert.ok(calls[0].data.html.includes(VARS.link), "the link reaches Mailgun untouched");
  assert.ok(calls[0].data.text.includes(VARS.link));
});

test("deliverEmail: a key without a domain fails loudly instead of quietly using the outbox", async () => {
  await withEnv({ MAILGUN_API_KEY: "key-1", MAILGUN_DOMAIN: undefined, NODE_ENV: "development" }, async () => {
    await assert.rejects(deliverEmail({ to: "a@b.co", ...inviteEmail(VARS) }), /MAILGUN_DOMAIN is not set/);
  });
});
