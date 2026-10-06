// Read new mail from the sales mailbox (the SENDER_EMAIL account) over IMAP.
// Gmail: the same app password as SMTP works; IMAP must be enabled in Gmail settings
// (it is by default for new accounts). Relative imports only.

const MAX_PER_SYNC = 100;

export function imapConfig() {
  const host = process.env.IMAP_SERVER || String(process.env.SMTP_SERVER || "").replace(/^smtp\./i, "imap.");
  return {
    host,
    port: Number(process.env.IMAP_PORT) || 993,
    secure: (Number(process.env.IMAP_PORT) || 993) === 993,
    auth: { user: process.env.SENDER_EMAIL, pass: process.env.SENDER_PASSWORD },
    logger: false,
  };
}

export function inboxConfigured() {
  const c = imapConfig();
  return Boolean(c.host && c.auth.user && c.auth.pass) && process.env.SALES_INBOX_SYNC !== "off";
}

/**
 * New messages in INBOX since the last sync.
 * @param state { uidValidity?, lastUid?, sinceDate? } — on the first run (or when the mailbox was
 *              rebuilt) everything since `sinceDate` is read
 * @returns {{ messages: Array<{ uid, mail }>, state: { uidValidity, lastUid } }} where `mail` is
 *          { messageId, inReplyTo, references, from, fromName, to, subject, text, html, date }
 */
export async function fetchNewMail(state = {}, { ImapFlowClass, parse } = {}) {
  const ImapFlow = ImapFlowClass || (await import("imapflow")).ImapFlow;
  const simpleParser = parse || (await import("mailparser")).simpleParser;
  const client = new ImapFlow(imapConfig());
  await client.connect();
  const out = [];
  let next = { uidValidity: state.uidValidity, lastUid: state.lastUid || 0 };
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const box = client.mailbox;
      const uidValidity = String(box.uidValidity);
      const fresh = !state.lastUid || String(state.uidValidity) !== uidValidity;
      let uids;
      if (fresh) {
        uids = (await client.search({ since: state.sinceDate || new Date(Date.now() - 7 * 24 * 3600 * 1000) }, { uid: true })) || [];
      } else {
        uids = (await client.search({ uid: `${state.lastUid + 1}:*` }, { uid: true })) || [];
        uids = uids.filter((u) => u > state.lastUid); // "n:*" returns the last message when nothing is newer
      }
      uids = uids.sort((a, b) => a - b).slice(0, MAX_PER_SYNC);
      next = { uidValidity, lastUid: Math.max(fresh ? 0 : state.lastUid, ...uids, 0) };
      if (fresh && !uids.length) next.lastUid = Math.max(0, (box.uidNext || 1) - 1);

      if (uids.length) {
        for await (const msg of client.fetch(uids, { uid: true, source: true }, { uid: true })) {
          const parsed = await simpleParser(msg.source);
          const from = parsed.from?.value?.[0] || {};
          out.push({
            uid: msg.uid,
            mail: {
              messageId: parsed.messageId || null,
              inReplyTo: parsed.inReplyTo || null,
              references: parsed.references || null,
              from: from.address || null,
              fromName: from.name || null,
              to: parsed.to?.value?.map((v) => v.address).filter(Boolean) || [],
              subject: parsed.subject || "",
              text: parsed.text || "",
              html: typeof parsed.html === "string" ? parsed.html : "",
              date: parsed.date || new Date(),
            },
          });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return { messages: out, state: next };
}
