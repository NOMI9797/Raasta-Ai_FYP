// Stage 3: interview invitation and link security (docs/ai-hiring/08-invitations.md).
// Real code: token creation, hashing, interview tickets (signed, expiring), candidate emails.
import assert from "node:assert/strict";
import crypto from "crypto";
import { SignJWT } from "jose";
import {
  TICKET_TTL_SECONDS, TicketError, createInviteToken, hashToken, maskToken, signTicket, verifyTicket,
} from "../../libs/interview/tokens";
import { ACCESS_ERRORS, isWellFormedToken } from "../../libs/interview/public-access";
import { inviteEmail, outcomeEmail, reminderEmail } from "../../libs/hiring/emails";

// A secret used only by this stage, so the cases can also forge tickets to check they are refused
const DEMO_SECRET = "demo-run-secret-for-the-test-cases-only-0123456789";
const key = new TextEncoder().encode(DEMO_SECRET);

const vars = {
  candidateName: "Ayesha Khan", jobTitle: "DevOps Engineer", link: "http://localhost:8085/interview/ABC",
  expiresAt: new Date("2026-10-12T10:00:00Z"), maxMinutes: 25, hiringTeam: "Zain Abbas", canReply: true,
};

export default {
  id: 3,
  title: "Invitation and link security",
  tier: "offline",
  intro: "The shortlisted candidate gets a private link. Can anyone else guess it, reuse it, or read a score in the email?",
  async setup() {
    const saved = process.env.INTERVIEW_TICKET_SECRET;
    process.env.INTERVIEW_TICKET_SECRET = DEMO_SECRET;
    return { saved };
  },
  async teardown({ saved }) {
    if (saved === undefined) delete process.env.INTERVIEW_TICKET_SECRET;
    else process.env.INTERVIEW_TICKET_SECRET = saved;
  },
  cases: [
    {
      id: "S3-01",
      title: "Invite links cannot be guessed: 43 random URL-safe characters, never repeated",
      requirement: "256 bits of randomness; the link is the only credential (08 §1).",
      input: "create 2000 invite tokens",
      expect: "every token matches [A-Za-z0-9_-]{43}, passes the link check, and all 2000 are different",
      run: async () => {
        const tokens = Array.from({ length: 2000 }, () => createInviteToken().token);
        assert.ok(tokens.every((t) => /^[A-Za-z0-9_-]{43}$/.test(t) && isWellFormedToken(t)));
        assert.equal(new Set(tokens).size, 2000);
        return `2000 tokens, ${new Set(tokens).size} distinct, example length ${tokens[0].length}`;
      },
    },
    {
      id: "S3-02",
      title: "Only a SHA-256 hash of the link is stored, never the link itself",
      requirement: "A database leak must not give anyone a working interview link (08 §1).",
      input: "one invite token",
      expect: "stored value = sha256(token) (computed independently), 64 hex characters, does not contain the token",
      run: async () => {
        const { token, tokenHash } = createInviteToken();
        const independent = crypto.createHash("sha256").update(token).digest("hex");
        assert.equal(tokenHash, independent);
        assert.match(tokenHash, /^[0-9a-f]{64}$/);
        assert.ok(!tokenHash.includes(token));
        assert.notEqual(hashToken(`${token}x`), tokenHash);
        return `hash ${tokenHash.slice(0, 12)}… (64 hex) equals an independent sha256`;
      },
    },
    {
      id: "S3-03",
      title: "Junk links are refused before the database is even asked",
      requirement: "Malformed tokens (guessing, path tricks, huge input) are a 404 immediately.",
      input: "\"\", \"short\", a link with spaces, \"../../etc/passwd\", 101 characters, null",
      expect: "all six refused",
      run: async () => {
        const junk = ["", "short", "has spaces in it 0123456789abcdef", "../../etc/passwd/../../etc/passwd", "a".repeat(101), null];
        assert.deepEqual(junk.map(isWellFormedToken), Array(6).fill(false));
        return "6 of 6 refused";
      },
    },
    {
      id: "S3-04",
      title: "Logs show a masked link only",
      requirement: "Hard rule 7: raw interview tokens are never logged.",
      input: "abcdefghijklmnop · \"short\" · undefined",
      expect: "abc…nop · … · …",
      run: async () => {
        const got = [maskToken("abcdefghijklmnop"), maskToken("short"), maskToken(undefined)];
        assert.deepEqual(got, ["abc…nop", "…", "…"]);
        return got.join(" · ");
      },
    },
    {
      id: "S3-05",
      title: "The live-interview ticket works and lives only about 10 minutes",
      requirement: "The WebSocket ticket is short-lived (09 §2).",
      input: "sign a ticket for interview int-1 / candidate cand-1, then verify it",
      expect: "claims round-trip; expiry between 9 and 10 minutes from now",
      run: async () => {
        const ticket = await signTicket({ interviewId: "int-1", candidateId: "cand-1" });
        const claims = await verifyTicket(ticket);
        assert.equal(claims.interviewId, "int-1");
        assert.equal(claims.candidateId, "cand-1");
        const minutes = (claims.expiresAt - Date.now()) / 60000;
        // The limits are written out here on purpose: comparing with the module's own constant would pass for any value
        assert.ok(minutes > 9 && minutes <= 10, `expires in ${minutes} min`);
        assert.equal(TICKET_TTL_SECONDS, 600);
        return `valid, expires in ${minutes.toFixed(1)} min`;
      },
    },
    {
      id: "S3-06",
      title: "A ticket that was edited, or is blank, is refused",
      requirement: "Signature check (HS256).",
      input: "a valid ticket with its last two characters changed · an empty string",
      expect: "TicketError for both",
      run: async () => {
        const ticket = await signTicket({ interviewId: "int-1", candidateId: "cand-1" });
        await assert.rejects(verifyTicket(`${ticket.slice(0, -2)}xx`), TicketError);
        await assert.rejects(verifyTicket(""), TicketError);
        return "tampered → TicketError · empty → TicketError";
      },
    },
    {
      id: "S3-07",
      title: "An expired ticket is refused with a clear reason",
      requirement: "Tickets must not work after their time.",
      input: "a correctly signed ticket that expired 60 seconds ago",
      expect: "TicketError \"Ticket expired\"",
      run: async () => {
        const now = Math.floor(Date.now() / 1000);
        const expired = await new SignJWT({ cid: "c", typ: "interview_ws" })
          .setProtectedHeader({ alg: "HS256" }).setSubject("i").setIssuedAt(now - 120).setExpirationTime(now - 60).sign(key);
        await assert.rejects(verifyTicket(expired), { name: "TicketError", message: "Ticket expired" });
        return "rejected: Ticket expired";
      },
    },
    {
      id: "S3-08",
      title: "A ticket forged with another secret, or for another purpose, is refused",
      requirement: "Only tickets this system signed for the interview socket are accepted.",
      input: "signed with a different secret · right secret but type \"something_else\"",
      expect: "TicketError for both",
      run: async () => {
        const otherKey = new TextEncoder().encode("a-completely-different-secret-0123456789abcdef");
        const forged = await new SignJWT({ cid: "c", typ: "interview_ws" }).setProtectedHeader({ alg: "HS256" }).setSubject("i").setExpirationTime("5m").sign(otherKey);
        const wrongType = await new SignJWT({ cid: "c", typ: "something_else" }).setProtectedHeader({ alg: "HS256" }).setSubject("i").setExpirationTime("5m").sign(key);
        await assert.rejects(verifyTicket(forged), TicketError);
        await assert.rejects(verifyTicket(wrongType), TicketError);
        return "foreign secret → refused · wrong type → refused";
      },
    },
    {
      id: "S3-09",
      title: "A missing server secret is reported as a setup error, not as a bad ticket",
      requirement: "A misconfigured server must fail loudly instead of rejecting every candidate silently.",
      input: "INTERVIEW_TICKET_SECRET removed",
      expect: "an error that is not a TicketError",
      run: async () => {
        const saved = process.env.INTERVIEW_TICKET_SECRET;
        delete process.env.INTERVIEW_TICKET_SECRET;
        try {
          await assert.rejects(verifyTicket("anything"), (error) => !(error instanceof TicketError) && /INTERVIEW_TICKET_SECRET/.test(error.message));
        } finally {
          process.env.INTERVIEW_TICKET_SECRET = saved;
        }
        return "error mentions INTERVIEW_TICKET_SECRET and is not a TicketError";
      },
    },
    {
      id: "S3-10",
      title: "A cancelled link and an unknown link show the candidate the same message",
      requirement: "The page does not reveal whether a link once existed; an expired one says whom to contact (10 §2). HTTP codes differ (404 vs 410).",
      input: "access errors for not_found, cancelled, expired",
      expect: "not_found and cancelled share one message; expired tells the candidate to contact the recruiter",
      run: async () => {
        assert.equal(ACCESS_ERRORS.not_found.message, ACCESS_ERRORS.cancelled.message);
        assert.match(ACCESS_ERRORS.expired.message, /Contact the recruiter/);
        assert.equal(ACCESS_ERRORS.completed.status, 409);
        return `not_found = cancelled = "${ACCESS_ERRORS.not_found.message.slice(0, 40)}…" · expired → 410`;
      },
    },
    {
      id: "S3-11",
      title: "The invite email has the link, the deadline, the language rule and an honest privacy line",
      requirement: "Candidates are told about recording and AI analysis before they start (08 §2).",
      input: "invite for Ayesha Khan, DevOps Engineer, 25 minutes, video and behaviour tracking on",
      expect: "link, English only, 25 minutes, deadline, \"recorded (audio and video)\", eye movement mention; subject names the job",
      run: async () => {
        const mail = inviteEmail({ ...vars, recordVideo: true, trackBehavior: true });
        assert.equal(mail.subject, "Your AI interview for DevOps Engineer");
        for (const part of ["http://localhost:8085/interview/ABC", "English only", "up to 25 minutes", "12 October 2026", "recorded (audio and video)", "eye movement"]) {
          assert.ok(mail.text.includes(part), `missing "${part}"`);
        }
        assert.ok(mail.html.includes("Start my interview"));
        return `subject "${mail.subject}" · text has link, deadline, English only, recording notice`;
      },
    },
    {
      id: "S3-12",
      title: "With video switched off, the email promises audio only",
      requirement: "The privacy line must match what the interview really records.",
      input: "invite with recordVideo false",
      expect: "\"recorded (audio)\", no camera requirement, no eye-movement mention",
      run: async () => {
        const mail = inviteEmail({ ...vars, recordVideo: false, trackBehavior: false });
        assert.ok(mail.text.includes("recorded (audio)"));
        assert.ok(!/eye movement|facial expressions/i.test(mail.text));
        const requirements = mail.text.split("BEFORE YOU START")[1].split("HOW IT WORKS")[0];
        assert.ok(!/camera/i.test(requirements), "the requirements must not ask for a camera");
        return "audio-only wording, no camera in the requirements, no eye-movement text";
      },
    },
    {
      id: "S3-13",
      title: "The reminder says when the link ends and that it replaces the earlier one",
      requirement: "A reminder rotates the link, so the old one stops working (08 §3).",
      input: "reminder 24 hours before the deadline",
      expect: "subject \"expires in 24 hours\"; text says it replaces the earlier link",
      run: async () => {
        const mail = reminderEmail({ ...vars, recordVideo: true }, new Date("2026-10-11T10:00:00Z"));
        assert.equal(mail.subject, "Reminder: your AI interview for DevOps Engineer expires in 24 hours");
        assert.ok(mail.text.includes("replaces the one in our earlier email"));
        return `"${mail.subject}"`;
      },
    },
    {
      id: "S3-14",
      title: "Outcome emails never contain a score, a percentage or the AI's reasoning",
      requirement: "Hard rule: candidates never see scores (11 §3).",
      input: "outcome emails for final_shortlisted and final_rejected",
      expect: "no \"score\", \"fit\", \"rating\", \"rank\", \"%\" and no 2-3 digit numbers anywhere in subject or text",
      run: async () => {
        const mails = ["final_shortlisted", "final_rejected"].map((outcome) => outcomeEmail({ outcome, candidateName: "Ayesha Khan", jobTitle: "DevOps Engineer", hiringTeam: "Zain Abbas" }));
        for (const mail of mails) {
          const body = `${mail.subject}\n${mail.text}`;
          assert.doesNotMatch(body, /score|\bfit\b|%|\b\d{2,3}\b|rating|rank/i);
        }
        return `2 outcome emails checked: "${mails[0].subject}" / "${mails[1].subject}"`;
      },
    },
  ],
};
