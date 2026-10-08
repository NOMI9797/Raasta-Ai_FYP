// Which lead an incoming email belongs to, and the new text in it. Pure, so it is unit-tested.
//
// Matching, most reliable first:
//  1. thread headers: In-Reply-To / References carry the Message-ID of an email we sent;
//  2. subject: "Re: <our subject>" from the address we wrote to (or from the test recipient,
//     while SALES_EMAIL_TEST_RECIPIENT redirects everything).
// Anything else in the mailbox is not a sales reply and is ignored, never stored.

/** "<a@x> <b@y>" or ["<a@x>"] → ["<a@x>", "<b@y>"] */
export function parseIdList(value) {
  const raw = Array.isArray(value) ? value.join(" ") : String(value || "");
  return raw.match(/<[^<>\s]+>/g) || [];
}

const PREFIX = /^\s*((re|fw|fwd|aw|wg|sv|antw)\s*(\[\d+\])?\s*:|\[test\])\s*/i;

/** Subject without Re:/Fwd: and the test tag, lower case, single spaces. */
export function normaliseSubject(subject) {
  let s = String(subject || "");
  for (let i = 0; i < 10 && PREFIX.test(s); i++) s = s.replace(PREFIX, "");
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

export const normaliseAddress = (a) => String(a || "").trim().toLowerCase();

// Where the quoted earlier email starts
const QUOTE_HEADERS = [
  /^On .{0,200}wrote:\s*$/,                 // Gmail, Apple Mail (joined over line breaks below)
  /^-{2,}\s*Original Message\s*-{2,}/i,     // Outlook
  /^_{10,}\s*$/,                            // Outlook web separator
  /^From: .+$/,                             // Outlook header block, when followed by Sent:/Date:
  /^\[Test email: this would have gone to/, // our own test banner, quoted back
];

/** The new text of a reply: no quoted history, no "> " lines, no signature after "-- ". */
export function stripQuotedReply(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Gmail wraps a long "On …, Name <email> wrote:" over two or three lines
    const joined = [line, lines[i + 1] || "", lines[i + 2] || ""].join(" ").replace(/\s+/g, " ");
    if (/^On\s/.test(line) && /^On .{0,250}wrote:/.test(joined)) break;
    if (QUOTE_HEADERS.slice(1, 3).some((re) => re.test(line))) break;
    if (/^From: /.test(line) && /^(Sent|Date|To): /i.test(lines[i + 1] || "")) break;
    if (QUOTE_HEADERS[4].test(line)) break;
    if (/^-- ?$/.test(line)) break;
    if (/^>/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * The sent email this one replies to, or null.
 * @param mail  { from, subject, inReplyTo, references }
 * @param sent  our sent emails: [{ id, emailMessageId, subject, toAddress, sentAt }]
 * @param opts  { testRecipient, now, maxAgeDays }
 * @returns {{ row, by: "thread"|"subject" } | null}
 */
export function matchReply(mail, sent, { testRecipient = null, now = new Date(), maxAgeDays = 90 } = {}) {
  const ids = [...parseIdList(mail.inReplyTo), ...parseIdList(mail.references).reverse()];
  for (const id of ids) {
    const row = sent.find((s) => s.emailMessageId && s.emailMessageId === id);
    if (row) return { row, by: "thread" };
  }

  const subject = normaliseSubject(mail.subject);
  if (!subject) return null;
  const from = normaliseAddress(mail.from);
  const test = normaliseAddress(testRecipient);
  const oldest = now.getTime() - maxAgeDays * 24 * 3600 * 1000;
  const candidates = sent
    .filter((s) => normaliseSubject(s.subject) === subject)
    .filter((s) => !s.sentAt || new Date(s.sentAt).getTime() >= oldest)
    .filter((s) => normaliseAddress(s.toAddress) === from || (test && from === test))
    .sort((a, b) => new Date(b.sentAt || 0) - new Date(a.sentAt || 0));
  return candidates.length ? { row: candidates[0], by: "subject" } : null;
}

/** Bounces and our own copies are never replies. */
export function isIgnorable(mail, { ownAddress }) {
  const from = normaliseAddress(mail.from);
  if (!from) return true;
  if (ownAddress && from === normaliseAddress(ownAddress)) return true;
  return /^(mailer-daemon|postmaster|no-?reply|noreply)@/.test(from);
}
