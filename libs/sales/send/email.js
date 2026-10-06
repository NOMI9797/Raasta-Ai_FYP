// Sends sales emails. Gmail (or any SMTP server) when SMTP_SERVER / SENDER_EMAIL / SENDER_PASSWORD are set,
// otherwise the local dev outbox (STORAGE_LOCAL_DIR/outbox) so nothing leaves the machine.
//
// SALES_EMAIL_TEST_RECIPIENT: while testing, every sales email goes to this address instead of the
// company, with a note saying who it was meant for. Remove it to send to real recipients.
// Relative imports only (runs in the worker).
import { randomUUID } from "crypto";
import { deliverEmail } from "../../hiring/emails";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailAddress(value) {
  return EMAIL_RE.test(String(value || "").trim());
}

export function smtpConfigured() {
  return Boolean(process.env.SMTP_SERVER && process.env.SENDER_EMAIL && process.env.SENDER_PASSWORD);
}

export function testRecipient() {
  const to = process.env.SALES_EMAIL_TEST_RECIPIENT?.trim();
  return to && isEmailAddress(to) ? to : null;
}

/** "smtp" | "outbox", and whether test redirect is on — for the UI, never the credentials. */
export function emailSetup() {
  return { transport: smtpConfigured() ? "smtp" : "outbox", testRecipient: testRecipient() };
}

const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain text and simple HTML of a sales email; with a test banner when redirected. */
export function renderEmail({ body, intendedTo }) {
  const banner = intendedTo ? `[Test email: this would have gone to ${intendedTo}]` : null;
  const text = banner ? `${banner}\n\n${body}` : body;
  const paragraphs = String(body)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const bannerHtml = banner
    ? `<p style="margin:0 0 18px;padding:8px 12px;background:#fff7e6;border:1px solid #f5c26b;border-radius:6px;font-size:13px">${escapeHtml(banner)}</p>`
    : "";
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2937;max-width:600px">${bannerHtml}${paragraphs}</div>`;
  return { text, html };
}

let transporter = null;
async function smtpTransport() {
  if (!transporter) {
    const nodemailer = (await import("nodemailer")).default;
    const port = Number(process.env.SMTP_PORT) || 587;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_SERVER,
      port,
      secure: port === 465, // 587 upgrades with STARTTLS
      auth: { user: process.env.SENDER_EMAIL, pass: process.env.SENDER_PASSWORD },
    });
  }
  return transporter;
}

/** A Message-ID we choose, so replies can be matched to this email: <uuid@sender-domain> */
export function newMessageId() {
  const domain = String(process.env.SENDER_EMAIL || "").split("@")[1] || "raasta.local";
  return `<${randomUUID()}@${domain}>`;
}

/**
 * Send one sales email. `inReplyTo` / `references` (Message-IDs) keep a reply in the client's thread;
 * `calendar` ({ method, content } from meetings/ics.js) attaches a calendar invite.
 * @returns {{ delivered: "smtp"|"outbox", to: string, intendedTo: string, redirected: boolean, messageId: string, file?: string }}
 * Throws on an invalid address or a failed send (the caller records it and may retry).
 */
export async function sendSalesEmail({ to, subject, body, senderName, inReplyTo = null, references = null, calendar = null }, { transport } = {}) {
  const intendedTo = String(to || "").trim();
  if (!isEmailAddress(intendedTo)) throw new Error(`Not a valid email address: ${intendedTo || "(empty)"}`);
  if (!String(body || "").trim()) throw new Error("The email is empty");

  const redirectTo = testRecipient();
  const actualTo = redirectTo || intendedTo;
  const finalSubject = redirectTo ? `[TEST] ${subject || "(no subject)"}` : subject || "(no subject)";
  const { text, html } = renderEmail({ body, intendedTo: redirectTo ? intendedTo : null });
  const messageId = newMessageId();
  const result = { to: actualTo, intendedTo, redirected: Boolean(redirectTo), messageId };
  const threading = {
    ...(inReplyTo ? { inReplyTo } : {}),
    ...(references ? { references: Array.isArray(references) ? references.join(" ") : references } : {}),
  };

  if (transport || smtpConfigured()) {
    const sender = transport || (await smtpTransport());
    const fromName = String(senderName || "").replace(/["<>]/g, "").trim();
    const info = await sender.sendMail({
      from: fromName ? `"${fromName}" <${process.env.SENDER_EMAIL}>` : process.env.SENDER_EMAIL,
      to: actualTo,
      subject: finalSubject,
      text,
      html,
      messageId,
      ...threading,
      // A calendar invite shows as "Add to calendar" in Gmail and Outlook: { method, content }
      ...(calendar ? { icalEvent: { method: calendar.method || "REQUEST", filename: "invite.ics", content: calendar.content } } : {}),
    });
    return { ...result, delivered: "smtp", messageId: info?.messageId || messageId };
  }

  const out = await deliverEmail({ to: actualTo, subject: finalSubject, text: `Message-ID: ${messageId}\n\n${text}`, html });
  return { ...result, delivered: out.delivered, file: out.file };
}
