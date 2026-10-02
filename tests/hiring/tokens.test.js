import { test, before } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import {
  createInviteToken, hashToken, maskToken, signTicket, verifyTicket, TicketError,
} from "../../libs/interview/tokens";

const SECRET = "test-secret-that-is-at-least-32-characters-long";
before(() => { process.env.INTERVIEW_TICKET_SECRET = SECRET; });

test("invite tokens are 43-char URL-safe and stored only as a sha256 hash", () => {
  const { token, tokenHash } = createInviteToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(tokenHash, hashToken(token));
  assert.match(tokenHash, /^[0-9a-f]{64}$/);
  assert.notEqual(createInviteToken().token, token);
});

test("maskToken never reveals the middle of a token", () => {
  assert.equal(maskToken("abcdefghijklmnop"), "abc…nop");
  assert.equal(maskToken("short"), "…");
  assert.equal(maskToken(undefined), "…");
});

test("tickets round-trip", async () => {
  const ticket = await signTicket({ interviewId: "int-1", candidateId: "cand-1" });
  const claims = await verifyTicket(ticket);
  assert.equal(claims.interviewId, "int-1");
  assert.equal(claims.candidateId, "cand-1");
  assert.ok(claims.expiresAt > new Date());
});

test("tampered, expired, wrong-type and missing tickets are rejected", async () => {
  const ticket = await signTicket({ interviewId: "int-1", candidateId: "cand-1" });
  await assert.rejects(verifyTicket(ticket.slice(0, -2) + "xx"), TicketError);
  await assert.rejects(verifyTicket(""), TicketError);

  const key = new TextEncoder().encode(SECRET);
  const expired = await new SignJWT({ cid: "c", typ: "interview_ws" })
    .setProtectedHeader({ alg: "HS256" }).setSubject("i")
    .setIssuedAt(Math.floor(Date.now() / 1000) - 120).setExpirationTime(Math.floor(Date.now() / 1000) - 60)
    .sign(key);
  await assert.rejects(verifyTicket(expired), { name: "TicketError", message: "Ticket expired" });

  const wrongType = await new SignJWT({ cid: "c", typ: "something_else" })
    .setProtectedHeader({ alg: "HS256" }).setSubject("i").setExpirationTime("5m").sign(key);
  await assert.rejects(verifyTicket(wrongType), TicketError);
});

test("a missing secret is a configuration error, not a bad ticket", async () => {
  const saved = process.env.INTERVIEW_TICKET_SECRET;
  delete process.env.INTERVIEW_TICKET_SECRET;
  try {
    await assert.rejects(verifyTicket("anything"), (error) => !(error instanceof TicketError));
  } finally {
    process.env.INTERVIEW_TICKET_SECRET = saved;
  }
});
