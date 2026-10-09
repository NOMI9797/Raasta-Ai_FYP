// Mailgun sender for every transactional email (interview invites, reminders, outcome emails,
// support-reply forwarding). Configuration comes from the environment, never from source:
//
//   MAILGUN_API_KEY   private API key (required to send)
//   MAILGUN_DOMAIN    the sending domain exactly as Mailgun lists it, e.g. mg.example.com or
//                     sandbox1234….mailgun.org (required to send)
//   MAILGUN_REGION    "us" (default) or "eu": the region the domain was created in
//   MAILGUN_API_URL   optional full API base URL; wins over MAILGUN_REGION
//   MAILGUN_FROM      optional sender, e.g. "Raasta-AI <noreply@mg.example.com>"
//   MAILGUN_REPLY_TO  optional default Reply-To
//
// Nothing here logs the key, a message body or a link (bodies carry interview links).
// Relative imports only: this also runs in the hiring worker.
import config from "../config";

const REGION_URLS = { us: "https://api.mailgun.net", eu: "https://api.eu.mailgun.net" };

export class MailError extends Error {
  /** code: not_configured | invalid_message | rejected | unreachable */
  constructor(message, { code = "rejected", status = null, hint = null } = {}) {
    super(message);
    this.name = "MailError";
    this.code = code;
    this.status = status;
    this.hint = hint;
  }
}

const clean = (value) => String(value ?? "").trim();

/** What the environment says about Mailgun. Never returns the key itself. */
export function mailgunSettings(env = process.env) {
  const apiKey = clean(env.MAILGUN_API_KEY);
  const domain = clean(env.MAILGUN_DOMAIN).replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const region = clean(env.MAILGUN_REGION).toLowerCase() === "eu" ? "eu" : "us";
  const url = clean(env.MAILGUN_API_URL).replace(/\/+$/, "") || REGION_URLS[region];
  const from = clean(env.MAILGUN_FROM) || (domain ? `${config.appName} <noreply@${domain}>` : "");
  const replyTo = clean(env.MAILGUN_REPLY_TO) || null;
  const missing = [];
  if (!apiKey) missing.push("MAILGUN_API_KEY");
  if (!domain) missing.push("MAILGUN_DOMAIN");
  return { apiKey, domain, region, url, from, replyTo, missing, configured: missing.length === 0, sandbox: /^sandbox[\w-]*\.mailgun\.org$/i.test(domain) };
}

export function isMailgunConfigured(env = process.env) {
  return mailgunSettings(env).configured;
}

/** The default sender: MAILGUN_FROM, else "<app name> <noreply@MAILGUN_DOMAIN>". */
export function defaultFrom(env = process.env) {
  return mailgunSettings(env).from || config.mailgun.fromNoReply;
}

let cached = null; // { signature, client }

function getClient(settings) {
  const signature = `${settings.url}|${settings.apiKey}`;
  if (cached?.signature === signature) return cached.client;
  // Loaded on first use so importing this file costs nothing and never needs a key
  const formData = require("form-data");
  const Mailgun = require("mailgun.js");
  const client = new Mailgun(formData).client({ username: "api", key: settings.apiKey, url: settings.url });
  cached = { signature, client };
  return client;
}

// What Mailgun's status codes usually mean, so a failed invite says what to fix
function explain(status, settings) {
  if (status === 401) return `Mailgun refused the API key. Check MAILGUN_API_KEY, and that MAILGUN_REGION matches where "${settings.domain}" was created (a US key against an EU domain is refused).`;
  if (status === 403) {
    return settings.sandbox
      ? `"${settings.domain}" is a Mailgun sandbox domain: it can only deliver to authorized recipients. Add the recipient under Sending > Domain settings > Authorized Recipients and have them confirm, or verify your own domain.`
      : `Mailgun refused to send from "${settings.domain}". Check the domain is verified and active in the Mailgun dashboard.`;
  }
  if (status === 404) return `Mailgun does not know the domain "${settings.domain}". Check MAILGUN_DOMAIN and MAILGUN_REGION.`;
  if (status === 400) return "Mailgun rejected the message (bad sender or recipient address).";
  if (status === 429) return "Mailgun rate limit reached; try again shortly.";
  return null;
}

function addresses(to) {
  const list = (Array.isArray(to) ? to : [to]).map(clean).filter(Boolean);
  const bad = list.find((a) => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(a.replace(/^.*<([^>]+)>$/, "$1")));
  if (!list.length || bad) throw new MailError("The recipient is not a valid email address", { code: "invalid_message" });
  return list;
}

/**
 * Send one email through Mailgun.
 *
 * @param {object} message
 * @param {string|string[]} message.to
 * @param {string} message.subject
 * @param {string} [message.text]    always send a plain-text part with the HTML one
 * @param {string} [message.html]
 * @param {string} [message.from]    defaults to defaultFrom()
 * @param {string} [message.replyTo]
 * @param {string[]} [message.tags]  Mailgun tags, for filtering in the dashboard
 * @param {boolean} [message.track]  open/click tracking; off by default, because tracking rewrites
 *                                   links and interview links carry a secret token
 * @param {object} [options]
 * @param {object} [options.client]  a Mailgun client (tests)
 * @param {object} [options.env]
 * @returns {Promise<{ id: string|null, message: string|null }>}
 */
export const sendEmail = async ({ to, subject, text, html, replyTo, from, tags, track = false }, { client, env = process.env } = {}) => {
  const settings = mailgunSettings(env);
  if (!settings.configured && !client) {
    throw new MailError(`Mailgun is not configured: ${settings.missing.join(" and ")} ${settings.missing.length > 1 ? "are" : "is"} not set`, {
      code: "not_configured",
      hint: "Add them to .env.local (see .env.example) and restart the web app and the worker.",
    });
  }
  const recipients = addresses(to);
  if (!clean(subject)) throw new MailError("The email has no subject", { code: "invalid_message" });
  if (!clean(text) && !clean(html)) throw new MailError("The email has no content", { code: "invalid_message" });

  const reply = replyTo || settings.replyTo;
  const data = {
    from: from || settings.from || config.mailgun.fromNoReply,
    to: recipients,
    subject: clean(subject).replace(/[\r\n]+/g, " "),
    ...(text ? { text } : {}),
    ...(html ? { html } : {}),
    ...(reply ? { "h:Reply-To": reply } : {}),
    ...(tags?.length ? { "o:tag": tags } : {}),
    "o:tracking": track ? "yes" : "no",
  };

  try {
    const result = await (client || getClient(settings)).messages.create(settings.domain, data);
    return { id: result?.id || null, message: result?.message || null };
  } catch (error) {
    const status = Number(error?.status) || null;
    const hint = explain(status, settings);
    const detail = clean(error?.details || error?.message).slice(0, 200);
    throw new MailError(`Mailgun could not send the email${status ? ` (HTTP ${status})` : ""}${detail ? `: ${detail}` : ""}`, {
      code: status ? "rejected" : "unreachable",
      status,
      hint,
    });
  }
};
