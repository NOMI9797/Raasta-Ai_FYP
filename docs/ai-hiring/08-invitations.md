# 08 · Interview Invitations

## Tokens: `libs/interview/tokens.js`

```js
import crypto from "crypto";
export function createInviteToken() {           // 43-char URL-safe
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}
export function hashToken(token) { return crypto.createHash("sha256").update(token).digest("hex"); }
// Short-lived WebSocket ticket (HS256 JWT, 10 min): { sub: interviewId, cid: candidateId, typ: "interview_ws" }
export function signTicket(payload) {...}       // uses INTERVIEW_TICKET_SECRET (use `jose` or built-in crypto HMAC)
export function verifyTicket(ticket) {...}
```
- Only `token_hash` is stored. The raw token exists only in the email link.
- Never log tokens. Mask them in errors (`abc…xyz`).
- Lookup is always `WHERE token_hash = hashToken(param)`.

## `libs/hiring/invitations.js`

```js
export async function sendInvite(candidateId, { resend = false } = {})
export async function sendReminder(interviewId)
export async function expireStaleInvites()   // called by worker every 15 min
export async function cancelInvite(interviewId)
```

**`sendInvite`:**
1. Load the candidate and job; the candidate status must be `shortlisted`, `interview_invited` (when resending) or `interview_expired`.
2. Ensure the job has active questions (`ensure-questions` must have succeeded). If not, throw a retryable error.
3. In one transaction:
   - set any active interview for the candidate to `cancelled`
   - insert a new `interviews` row (`status:'invited'`, `tokenHash`, `expiresAt = now + inviteExpiryHours`)
   - set the candidate to `interview_invited`
4. Send the email (template below) via `sendEmail`. If sending fails, mark `interviews.errorMessage` and retry via the worker (the token stays valid).
5. Publish `hiring:{userId}` event `{type:'invite_sent', candidateId}` for UI refresh.

**`sendReminder`** (worker sweep every 15 min): `status='invited' AND opened_at IS NULL AND reminder_sent_at IS NULL AND invited_at < now - reminderAfterHours AND expires_at > now + 2h`. The reminder email reuses the link. **Note:** the raw token isn't stored, so the reminder rotates the token (new hash, same row) and emails the new link. The old link then resolves to "not found" and shows "This link is no longer valid. Please use the link in your most recent email."

**`expireStaleInvites`:** `status IN ('invited','opened') AND expires_at < now` → interview `expired`, candidate `interview_expired`.

## Email templates: `libs/hiring/emails.js`

Plain, branded "Raasta-AI". HTML + text versions. Sender `config.mailgun.fromNoReply`. Recruiter's name/company if available (`users.name`), otherwise "the hiring team".

**Invite**
- Subject: `Your AI interview for {jobTitle}`
- Body points:
  - Congratulations, you've been shortlisted for **{jobTitle}**.
  - The next step is a ~{interviewMaxMinutes}-minute voice interview with the Raasta AI Interviewer, taken any time before **{expiresAt in candidate-friendly format, with timezone}**.
  - Requirements: a quiet place, Chrome or Edge on a laptop/desktop, a working microphone (and camera if `recordVideo`), and a stable internet connection.
  - How it works: questions are asked aloud; answer by speaking; you can press "I've finished my answer".
  - Privacy: the interview is recorded and evaluated by AI and reviewed by the hiring team.
  - Button: **Start my interview** → `{NEXT_PUBLIC_APP_URL}/interview/{token}`
  - "If the button doesn't work, copy this link: …"

**Reminder:** subject `Reminder: your AI interview for {jobTitle} expires {relative}`.

**Outcome emails** (only if `sendOutcomeEmails` and after the recruiter approves):
- `final_shortlisted` → "You've moved to the next round" (recruiter will contact).
- `final_rejected` / `not_shortlisted` → a polite thank-you. Never include scores.

## APIs

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /api/hiring/candidates/[candidateId]/invite` | withAuth + owner | Send now, or `{ resend: true }` |
| `POST /api/hiring/interviews/[interviewId]/extend` | withAuth + owner | Body `{ hours }`; moves `expires_at`; if expired → back to `invited` + `interview_invited` |
| `POST /api/hiring/interviews/[interviewId]/cancel` | withAuth + owner | Cancel invite |

## Acceptance
- Shortlisting a candidate with `autoInvite` sends exactly one email within 1 minute (worker running).
- An expired link shows an "expired" page; a cancelled link shows "no longer valid"; a resent link invalidates the old one.
- Tokens never appear in logs (`grep` the server output during the test).
