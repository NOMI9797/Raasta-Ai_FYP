// Invite / reminder / outcome emails and the dev outbox (docs/ai-hiring/08-invitations.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { deliverEmail, formatExpiry, inviteEmail, outcomeEmail, relativeExpiry, reminderEmail } from "../../libs/hiring/emails";

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
    assert.match(body, /about 25 minutes/);
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
