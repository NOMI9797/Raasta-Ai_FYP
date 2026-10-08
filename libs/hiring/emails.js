// Candidate emails for the AI hiring pipeline (docs/ai-hiring/08-invitations.md).
// Raasta-AI branded, HTML + plain text. Never include scores.
// Sent through Mailgun (libs/mailgun.js). Without MAILGUN_API_KEY outside production, emails go to a
// dev outbox folder instead (STORAGE_LOCAL_DIR/outbox) so invite links can be opened locally.
// Links are never logged.
// Relative imports only — also runs in the hiring worker.
import fs from "fs/promises";
import path from "path";
import config from "../../config";
import { defaultFrom, sendEmail } from "../mailgun";

const BRAND = config.appName || "Raasta-AI";
const INTERVIEWER = "Raasta AI Interviewer";
const ACCENT = "#4f46e5";

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

// ───────────────────────────── HTML building blocks ─────────────────────────────
// Email clients ignore most modern CSS, so the layout is nested tables with inline styles.

const FONT = "font-family:'Segoe UI',Helvetica,Arial,sans-serif;";

const para = (html, margin = "0 0 16px") => `<p style="margin:${margin};${FONT}font-size:15px;line-height:1.6;color:#1f2937">${html}</p>`;
const heading = (text) => `<h1 style="margin:0 0 18px;${FONT}font-size:22px;line-height:1.3;font-weight:700;color:#111827">${text}</h1>`;
const subheading = (text) => `<h2 style="margin:28px 0 10px;${FONT}font-size:13px;line-height:1.4;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7280">${text}</h2>`;

function list(items, ordered = false) {
  const tag = ordered ? "ol" : "ul";
  const rows = items.map((item) => `<li style="margin:0 0 6px;padding-left:2px">${item}</li>`).join("");
  return `<${tag} style="margin:0 0 8px;padding-left:22px;${FONT}font-size:15px;line-height:1.55;color:#1f2937">${rows}</${tag}>`;
}

function detailsBox(rows) {
  const body = rows.map(([label, value], i) => `<tr>
<td style="padding:${i === 0 ? "14px" : "6px"} 12px ${i === rows.length - 1 ? "14px" : "6px"} 18px;${FONT}font-size:13px;color:#6b7280;white-space:nowrap;vertical-align:top">${label}</td>
<td style="padding:${i === 0 ? "14px" : "6px"} 18px ${i === rows.length - 1 ? "14px" : "6px"} 0;${FONT}font-size:14px;font-weight:600;color:#111827;vertical-align:top">${value}</td>
</tr>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;background:#f5f6ff;border:1px solid #e0e3ff;border-radius:10px">${body}</table>`;
}

function button({ label, href }) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 14px"><tr>
<td align="center" bgcolor="${ACCENT}" style="border-radius:8px"><a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 30px;${FONT}font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(label)}</a></td>
</tr></table>
<p style="margin:0 0 8px;${FONT}font-size:13px;line-height:1.5;color:#6b7280">If the button doesn't work, copy this link into your browser:<br><a href="${escapeHtml(href)}" style="color:${ACCENT};word-break:break-all">${escapeHtml(href)}</a></p>`;
}

function note(html, { tone = "muted", margin = "18px 0 0" } = {}) {
  const colours = tone === "warning"
    ? { bg: "#fffbeb", border: "#fde68a", text: "#92400e" }
    : { bg: "#f9fafb", border: "#e5e7eb", text: "#4b5563" };
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:${margin};background:${colours.bg};border:1px solid ${colours.border};border-radius:8px"><tr>
<td style="padding:12px 16px;${FONT}font-size:13px;line-height:1.55;color:${colours.text}">${html}</td></tr></table>`;
}

function layout({ title, preheader, content, footer }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${escapeHtml(preheader || "")}${"&nbsp;&zwnj;".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">
<tr><td style="padding:0 4px 14px;${FONT}font-size:20px;font-weight:700;color:${ACCENT}">${escapeHtml(BRAND)}</td></tr>
<tr><td style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:32px 30px">${content}</td></tr>
<tr><td style="padding:16px 4px 0;${FONT}font-size:12px;line-height:1.6;color:#6b7280">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

function footerHtml({ team, jobTitle, canReply }) {
  const why = jobTitle ? `You are receiving this email because you applied for ${escapeHtml(jobTitle)}. ` : "";
  return `${why}Sent by ${escapeHtml(BRAND)} on behalf of ${escapeHtml(team)}.${canReply ? " Questions? Just reply to this email." : ""}`;
}

function footerText({ team, jobTitle, canReply }) {
  const why = jobTitle ? `You are receiving this email because you applied for ${jobTitle}.\n` : "";
  return `--\n${why}Sent by ${BRAND} on behalf of ${team}.${canReply ? " Questions? Just reply to this email." : ""}`;
}

// ───────────────────────────── invite / reminder ─────────────────────────────

function requirementsList({ recordVideo }) {
  return [
    "a quiet place",
    "Chrome or Edge on a laptop or desktop computer",
    recordVideo ? "a working microphone and camera" : "a working microphone",
    "a stable internet connection",
  ];
}

// What is recorded and analysed, in one sentence candidates read before they agree
function privacyLine({ recordVideo, trackBehavior, team }) {
  const analysed = recordVideo && trackBehavior ? ", analysed with the help of AI (including eye movement, head movement and facial expressions on camera)" : ", evaluated with the help of AI";
  return `Privacy: the interview is recorded (${recordVideo ? "audio and video" : "audio"})${analysed} and reviewed by ${team}.`;
}

const steps = () => [
  "Open the link and allow microphone access (and camera access if asked). A short check makes sure everything works.",
  `The ${INTERVIEWER} asks each question aloud. Answer by speaking, in English: the whole interview is conducted in English.`,
  "When you finish an answer, press <em>I've finished my answer</em>. You can repeat a question twice, or end the interview at any time.",
];

const stepsText = () => steps().map((s) => s.replace(/<\/?em>/g, '"'));

/** "up to 25 minutes" */
const lengthLabel = (minutes) => `up to ${minutes} minutes`;

/**
 * Invite email. vars: { candidateName, jobTitle, link, expiresAt, maxMinutes, recordVideo, trackBehavior,
 * hiringTeam, canReply }. `notice` (reminders) is a line shown above everything else.
 */
export function inviteEmail({ candidateName, jobTitle, link, expiresAt, maxMinutes, recordVideo, trackBehavior, hiringTeam, canReply = false, notice = null }) {
  const name = firstName(candidateName);
  const team = hiringTeam || "the hiring team";
  const expiry = formatExpiry(expiresAt);
  const reqs = requirementsList({ recordVideo });
  const length = lengthLabel(maxMinutes);
  const privacy = privacyLine({ recordVideo, trackBehavior, team });
  const subject = `Your AI interview for ${jobTitle}`;
  const intro = `Congratulations, you've been shortlisted for ${jobTitle}. The next step is a short voice interview with the ${INTERVIEWER}, which you can take whenever suits you before the deadline below.`;

  const text = [
    ...(notice ? [notice, ""] : []),
    `Hi ${name},`,
    "",
    intro,
    "",
    "INTERVIEW DETAILS",
    `  Role:         ${jobTitle}`,
    `  Format:       Voice interview with the ${INTERVIEWER}`,
    "  Language:     English only",
    `  Length:       ${length}`,
    `  Complete by:  ${expiry}`,
    "",
    "START YOUR INTERVIEW",
    link,
    "",
    "BEFORE YOU START, YOU WILL NEED",
    ...reqs.map((r) => `- ${r}`),
    "",
    "HOW IT WORKS",
    ...stepsText().map((s, i) => `${i + 1}. ${s}`),
    "",
    privacy,
    "",
    "Good luck!",
    `${team} via ${BRAND}`,
    "",
    footerText({ team, jobTitle, canReply }),
  ].join("\n");

  const html = layout({
    title: subject,
    preheader: `You've been shortlisted for ${jobTitle}. Your voice interview takes ${length}.`,
    footer: footerHtml({ team, jobTitle, canReply }),
    content: [
      notice ? note(escapeHtml(notice), { tone: "warning", margin: "0 0 22px" }) : "",
      heading(`Your interview for ${escapeHtml(jobTitle)}`),
      para(`Hi ${escapeHtml(name)},`),
      para(`Congratulations, you've been shortlisted for <strong>${escapeHtml(jobTitle)}</strong>. The next step is a short voice interview with the ${INTERVIEWER}, which you can take whenever suits you before the deadline below.`),
      detailsBox([
        ["Role", escapeHtml(jobTitle)],
        ["Format", `Voice interview with the ${INTERVIEWER}`],
        ["Language", "English only"],
        ["Length", escapeHtml(length)],
        ["Complete by", escapeHtml(expiry)],
      ]),
      button({ label: "Start my interview", href: link }),
      subheading("Before you start, you will need"),
      list(reqs.map(escapeHtml)),
      subheading("How it works"),
      list(steps(), true),
      note(escapeHtml(privacy)),
      para(`Good luck!<br>${escapeHtml(team)} via ${escapeHtml(BRAND)}`, "22px 0 0"),
    ].join(""),
  });
  return { subject, text, html };
}

/** Reminder email: same content, subject and a notice line say when it expires. */
export function reminderEmail(vars, now = new Date()) {
  const when = relativeExpiry(vars.expiresAt, now);
  const notice = `This is a reminder: your interview link expires ${when}. This link replaces the one in our earlier email.`;
  const invite = inviteEmail({ ...vars, notice });
  return { ...invite, subject: `Reminder: your AI interview for ${vars.jobTitle} expires ${when}` };
}

// ───────────────────────────── outcome ─────────────────────────────

/**
 * Outcome emails (Phase 7+, only with sendOutcomeEmails and after the recruiter approves).
 * outcome: "final_shortlisted" | "final_rejected" | "not_shortlisted"
 */
export function outcomeEmail({ outcome, candidateName, jobTitle, hiringTeam, canReply = false }) {
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
    text: `${lines.join("\n\n")}\n\n${team} via ${BRAND}\n\n${footerText({ team, jobTitle, canReply })}`,
    html: layout({
      title: subject,
      preheader: lines[1],
      footer: footerHtml({ team, jobTitle, canReply }),
      content: [
        heading(escapeHtml(positive ? "You've moved to the next round" : "An update on your application")),
        ...lines.map((line) => para(escapeHtml(line))),
        para(`${escapeHtml(team)} via ${escapeHtml(BRAND)}`, "22px 0 0"),
      ].join(""),
    }),
  };
}

// ───────────────────────────── delivery ─────────────────────────────

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
 * Send an email. Returns { delivered: "mailgun", id } or { delivered: "outbox", file }.
 * Throws when sending fails (callers retry); a MailError says what to fix. Never logs the body (it can
 * contain an invite link).
 */
export async function deliverEmail({ to, subject, text, html, from, replyTo, tags }, { send, client } = {}) {
  const sender = from || defaultFrom();
  if (send) {
    await send({ to, subject, text, html, from: sender, replyTo, tags });
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
  const result = await sendEmail({ to, subject, text, html, from: sender, replyTo, tags }, { client });
  return { delivered: "mailgun", id: result.id };
}
