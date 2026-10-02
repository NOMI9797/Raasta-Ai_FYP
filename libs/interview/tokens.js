// Interview invite tokens and WebSocket tickets (docs/ai-hiring/08-invitations.md).
// Never log raw tokens or tickets; use maskToken() in errors.
import crypto from "crypto";
import { SignJWT, jwtVerify } from "jose";

export const TICKET_TYPE = "interview_ws";
export const TICKET_TTL_SECONDS = 10 * 60;

export function createInviteToken() {           // 43-char URL-safe
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function maskToken(token) {
  if (typeof token !== "string" || token.length < 8) return "…";
  return `${token.slice(0, 3)}…${token.slice(-3)}`;
}

export class TicketError extends Error {
  constructor(message) {
    super(message);
    this.name = "TicketError";
  }
}

function ticketKey() {
  const secret = process.env.INTERVIEW_TICKET_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("INTERVIEW_TICKET_SECRET must be set (32+ characters)");
  }
  return new TextEncoder().encode(secret);
}

/**
 * Short-lived WebSocket ticket (HS256 JWT): { sub: interviewId, cid: candidateId, typ: "interview_ws" }
 */
export async function signTicket({ interviewId, candidateId }, { ttlSeconds = TICKET_TTL_SECONDS } = {}) {
  if (!interviewId || !candidateId) throw new Error("signTicket needs interviewId and candidateId");
  return new SignJWT({ cid: candidateId, typ: TICKET_TYPE })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(interviewId)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(ticketKey());
}

/**
 * Verify a ticket's signature, expiry and type.
 * Returns { interviewId, candidateId, expiresAt }; throws TicketError if invalid.
 */
export async function verifyTicket(ticket) {
  if (typeof ticket !== "string" || ticket.length === 0) {
    throw new TicketError("Missing ticket");
  }
  const key = ticketKey(); // a missing secret is a config error, not a bad ticket
  let payload;
  try {
    ({ payload } = await jwtVerify(ticket, key, { algorithms: ["HS256"] }));
  } catch (error) {
    throw new TicketError(error?.code === "ERR_JWT_EXPIRED" ? "Ticket expired" : "Invalid ticket");
  }
  if (payload.typ !== TICKET_TYPE || !payload.sub || !payload.cid) {
    throw new TicketError("Invalid ticket");
  }
  return {
    interviewId: payload.sub,
    candidateId: payload.cid,
    expiresAt: new Date(payload.exp * 1000),
  };
}
