import "../../libs/load-env"; // first: reads .env.local
// Live checks of the outside services the sales module depends on, with the real credentials in
// .env.local. Skipped unless RUN_LIVE_TESTS=1, because they need the network and real accounts:
//   npm run test:sales:live
// Nothing is emailed: SMTP is only connected to and verified, IMAP only counts recent messages.
import { test } from "node:test";
import assert from "node:assert/strict";

const LIVE = process.env.RUN_LIVE_TESTS === "1";
const skip = LIVE ? false : "set RUN_LIVE_TESTS=1 to run live checks";

test("Gmail SMTP accepts our login (no email is sent)", { skip, timeout: 30000 }, async () => {
  const nodemailer = (await import("nodemailer")).default;
  const port = Number(process.env.SMTP_PORT) || 587;
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_SERVER, port, secure: port === 465,
    auth: { user: process.env.SENDER_EMAIL, pass: process.env.SENDER_PASSWORD },
  });
  assert.equal(await transport.verify(), true);
  transport.close();
});

test("Gmail IMAP: the sales mailbox can be read (counts only)", { skip, timeout: 60000 }, async () => {
  const { fetchNewMail, imapConfig } = await import("../../libs/sales/inbox/imap");
  assert.ok(imapConfig().host, "IMAP server known");
  const { messages, state } = await fetchNewMail({ sinceDate: new Date(Date.now() - 2 * 864e5) });
  assert.ok(Array.isArray(messages));
  assert.ok(state.uidValidity, "mailbox opened");
  assert.ok(state.lastUid >= 0);
});

test("Groq AI answers in JSON with the configured fast model", { skip, timeout: 60000 }, async () => {
  const { chatJSON, getFastModel } = await import("../../libs/ai/llm");
  const out = await chatJSON({ system: 'Return JSON: {"ok": true, "sum": number}', user: "What is 2 + 3?", model: getFastModel(), maxTokens: 300 });
  assert.equal(out.ok, true);
  assert.equal(Number(out.sum), 5);
});

test("Indeed search through JobSpy returns job posts with company names", { skip, timeout: 180000 }, async () => {
  const { searchIndeedJobs } = await import("../../libs/indeed-job-search");
  const { jobs } = await searchIndeedJobs({ query: "react developer", location: "Lahore", country: "pakistan", limit: 3 });
  assert.ok(jobs.length > 0, "found job posts");
  assert.ok(jobs.some((j) => j.company), "with company names");
});

test("the local embedding model turns text into 384 numbers", { skip, timeout: 300000 }, async () => {
  const { embedTexts } = await import("../../libs/sales/knowledge/embed");
  const [a, b, c] = await embedTexts(["How much does a website cost?", "Our websites start at $1,500", "We are closed on Sundays"]);
  const dot = (x, y) => x.reduce((s, v, i) => s + v * y[i], 0);
  assert.equal(a.length, 384);
  assert.ok(dot(a, b) > dot(a, c) + 0.3, "a pricing question is closest to the pricing answer");
});
