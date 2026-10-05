// Candidate emails for the AI hiring pipeline (docs/ai-hiring/08-invitations.md).
// Plain, Raasta-AI branded, HTML + text. Never include scores.
// Without MAILGUN_API_KEY outside production, emails go to a dev outbox folder instead
// (STORAGE_LOCAL_DIR/outbox) so invite links can be opened locally. Links are never logged.
// Relative imports only — also runs in the hiring worker.
import fs from "fs/promises";
import path from "path";
import config from "../../config";

const BRAND = config.appName || "Raasta-AI";
const INTERVIEWER = "Raasta AI Interviewer";
const FROM_NO_REPLY = config.mailgun.fromNoReply;

export function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "http://localhost:8085").replace(/\/$/, "");
}

export function interviewLink(token) {
  return `${appUrl()}/interview/${token}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "Friday, 10 October 2026, 14:30 UTC" (candidate-friendly, with the timezone) */
export function formatExpiry(date, timeZone = process.env.EMAIL_TIMEZONE || "UTC") {
  const d = new Date(date);
  const formatted = new Intl.DateTimeFormat("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone,
  }).format(d);
  return `${formatted} ${timeZone === "UTC" ? "UTC" : `(${timeZone})`}`;
}

/** "in 5 hours" / "in 2 days" */
export function relativeExpiry(date, now = new Date()) {
  const ms = new Date(date) - now;
  if (ms < 3600000) return "within the hour";
  const hours = Math.round(ms / 3600000);
  if (hours < 48) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  return `in ${Math.round(hours / 24)} days`;
}

function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "there";
}

function layout({ heading, paragraphs, button, footer }) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.55">${p}</p>`).join("");
  const cta = button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(button.href)}" style="background:#6366F1;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">${escapeHtml(button.label)}</a></p>
       <p style="margin:0 0 14px;font-size:13px;color:#555">If the button doesn't work, copy this link into your browser:<br><a href="${escapeHtml(button.href)}" style="color:#6366F1;word-break:break-all">${escapeHtml(button.href)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1f2937">
<div style="max-width:560px;margin:0 auto;padding:28px 16px">
<div style="font-weight:700;font-size:18px;color:#6366F1;margin-bottom:16px">${BRAND}</div>
<div style="background:#fff;border-radius:12px;padding:28px">
<h1 style="font-size:20px;margin:0 0 16px">${heading}</h1>${body}${cta}
</div>
<p style="font-size:12px;color:#888;margin-top:16px">${footer || `Sent by ${BRAND} on behalf of the hiring team.`}</p>
</div></body></html>`;
}

function requirementsList({ recordVideo }) {
  return [
    "a quiet place",
    "Chrome or Edge on a laptop or desktop computer",
    recordVideo ? "a working microphone and camera" : "a working microphone",
    "a stable internet connection",
  ];
}

/**
 * Invite email. vars: { candidateName, jobTitle, link, expiresAt, maxMinutes, recordVideo, hiringTeam }
 */
export function inviteEmail({ candidateName, jobTitle, link, expiresAt, maxMinutes, recordVideo, hiringTeam }) {
  const name = firstName(candidateName);
  const team = hiringTeam || "the hiring team";
  const expiry = formatExpiry(expiresAt);
  const reqs = requirementsList({ recordVideo });
  const subject = `Your AI interview for ${jobTitle}`;

  const text = [
    `Hi ${name},`,
    "",
    `Congratulations, you've been shortlisted for ${jobTitle}.`,
    "",
    `The next step is a voice interview of about ${maxMinutes} minutes with the ${INTERVIEWER}. You can take it any time before ${expiry}.`,
    "",
    "You'll need:",
    ...reqs.map((r) => `- ${r}`),
    "",
    "How it works: the questions are asked aloud and you answer by speaking. When you're done with an answer, press \"I've finished my answer\".",
    "",
    `Privacy: the interview is recorded (${recordVideo ? "audio and video" : "audio"}), evaluated with the help of AI and reviewed by ${team}.`,
    "",
    `Start my interview: ${link}`,
    "",
    `Good luck!`,
    `${team} via ${BRAND}`,
  ].join("\n");

  const html = layout({
    heading: `Your interview for ${escapeHtml(jobTitle)}`,
    paragraphs: [
      `Hi ${escapeHtml(name)},`,
      `Congratulations, you've been shortlisted for <strong>${escapeHtml(jobTitle)}</strong>.`,
      `The next step is a voice interview of about ${escapeHtml(maxMinutes)} minutes with the ${INTERVIEWER}. You can take it any time before <strong>${escapeHtml(expiry)}</strong>.`,
      `You'll need: ${reqs.map(escapeHtml).join(", ")}.`,
      "How it works: the questions are asked aloud and you answer by speaking. When you're done with an answer, press <em>I've finished my answer</em>.",
      `Privacy: the interview is recorded (${recordVideo ? "audio and video" : "audio"}), evaluated with the help of AI and reviewed by ${escapeHtml(team)}.`,
    ],
    button: { label: "Start my interview", href: link },
    footer: `Sent by ${BRAND} on behalf of ${escapeHtml(team)}.`,
  });
  return { subject, text, html };
}

/** Reminder email: same content, subject says when it expires. */
export function reminderEmail(vars, now = new Date()) {
  const invite = inviteEmail(vars);
  const when = relativeExpiry(vars.expiresAt, now);
  const subject = `Reminder: your AI interview for ${vars.jobTitle} expires ${when}`;
  const note = `This is a reminder: your interview link expires ${when}. This link replaces the one in our earlier email.`;
  return {
    subject,
    text: `${note}\n\n${invite.text}`,
    html: invite.html.replace("<h1", `<p style="margin:0 0 14px;padding:10px 12px;background:#FEF3C7;border-radius:8px">${escapeHtml(note)}</p><h1`),
  };
}

/**
 * Outcome emails (Phase 7+, only with sendOutcomeEmails and after the recruiter approves).
 * outcome: "final_shortlisted" | "final_rejected" | "not_shortlisted"
 */
export function outcomeEmail({ outcome, candidateName, jobTitle, hiringTeam }) {
  const name = firstName(candidateName);
  const team = hiringTeam || "the hiring team";
  const positive = outcome === "final_shortlisted";
  const subject = positive ? `You've moved to the next round for ${jobTitle}` : `Your application for ${jobTitle}`;
  const lines = positive
    ? [`Hi ${name},`, `Good news: you've moved to the next round for ${jobTitle}.`, `${team} will contact you soon with the next steps.`]
    : [`Hi ${name},`, `Thank you for your interest in ${jobTitle} and for the time you spent on your application.`,
      `After careful consideration, ${team} has decided not to move forward with your application at this time.`, "We wish you the best in your search."];
  return {
    subject,
    text: `${lines.join("\n\n")}\n\n${team} via ${BRAND}`,
    html: layout({ heading: escapeHtml(subject), paragraphs: lines.map(escapeHtml) }),
  };
}

function outboxDir() {
  return path.resolve(process.env.STORAGE_LOCAL_DIR || "./.storage", "outbox");
}

// Without a Mailgun key, emails go to the local outbox. Production refuses that, unless EMAIL_OUTBOX=local
// says so (npm run serve sets it: a fast local run is not a deployment).
export function usesDevOutbox() {
  if (process.env.MAILGUN_API_KEY) return false;
  return process.env.NODE_ENV !== "production" || process.env.EMAIL_OUTBOX === "local";
}

/**
 * Send an email. Returns { delivered: "mailgun" } or { delivered: "outbox", file }.
 * Throws when sending fails (callers retry). Never logs the body (it can contain an invite link).
 */
export async function deliverEmail({ to, subject, text, html, from = FROM_NO_REPLY }, { send } = {}) {
  if (send) {
    await send({ to, subject, text, html, from });
    return { delivered: "custom" };
  }
  if (usesDevOutbox()) {
    const dir = outboxDir();
    await fs.mkdir(dir, { recursive: true });
    const slug = String(to).replace(/[^a-z0-9@._-]/gi, "_");
    const base = `${new Date().toISOString().replace(/[:.]/g, "-")}-${slug}`;
    await fs.writeFile(path.join(dir, `${base}.html`), html, "utf8");
    await fs.writeFile(path.join(dir, `${base}.txt`), `To: ${to}\nSubject: ${subject}\n\n${text}`, "utf8");
    return { delivered: "outbox", file: `${base}.html` };
  }
  if (!process.env.MAILGUN_API_KEY) throw new Error("MAILGUN_API_KEY is not set");
  const { sendEmail } = await import("../mailgun");
  await sendEmail({ to, subject, text, html, from });
  return { delivered: "mailgun" };
}
