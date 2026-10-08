// What a candidate's words mean for the interview itself: "end the interview" and "I'd rather not
// answer". Plain rules, no LLM: they run on every answer and must be predictable, and a wrong guess
// has a cost either way (ending an interview by mistake, or asking someone who refused to elaborate).
// Relative imports only — runs in the interview engine.

const MAX_END_REQUEST_WORDS = 40;   // a long answer that mentions "end the interview" is not a request
const MAX_SHORT_REQUEST_WORDS = 14; // "please stop", "can we end this"
const MAX_DECLINE_WORDS = 14;

const words = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9'\s]/g, " ").replace(/\s+/g, " ").trim();
const count = (text) => (text ? text.split(" ").length : 0);

// "end the interview", "kindly end my interview right now", "trigger the ending of the interview"
const END_THE_INTERVIEW = /\b(end|ending|stop|stopping|finish|finishing|terminate|terminating|conclude|cancel|close|closing|wrap up)\b(?:\s+\w+){0,4}?\s+(?:the\s+|this\s+|my\s+|our\s+)?interview\b/;
const DONE_WITH_INTERVIEW = /\b(done|finished|through)\s+with\s+(?:this|the|my)\s+interview\b/;
const DONT_CONTINUE = /\b(?:i\s+)?(?:don'?t|do not)\s+want\s+to\s+(?:continue|go on|proceed)\b/;
const QUIT = /\bi\s+quit\b/;
// Short requests with no object: "please end it", "let's stop here", "I want to stop"
const SHORT_REQUEST = /\b(?:please|kindly|let'?s|can we|could we|can you|could you|i want to|i wanna|i would like to|i'd like to|i need to|just)\s+(end|stop|finish|quit|leave|wrap up)\b((?:\s+\w+){0,3})\s*$/;
const REQUEST_FILLER = new Set(["this", "it", "here", "now", "right", "please", "the", "interview", "my", "call", "kindly", "thanks", "thank", "you", "today", "so", "immediately", "up", "session", "conversation"]);

/** True when the candidate asks to end the interview. */
export function detectEndRequest(text) {
  const t = words(text);
  const n = count(t);
  if (!n || n > MAX_END_REQUEST_WORDS) return false;
  if (END_THE_INTERVIEW.test(t) || DONE_WITH_INTERVIEW.test(t) || DONT_CONTINUE.test(t) || QUIT.test(t)) return true;
  if (n <= MAX_SHORT_REQUEST_WORDS) {
    const match = SHORT_REQUEST.exec(t);
    if (match) return match[2].trim().split(" ").filter(Boolean).every((w) => REQUEST_FILLER.has(w));
  }
  return false;
}

const DECLINE_PATTERNS = [
  /\b(?:don'?t|do not|didn'?t|did not)\s+(?:want|wish|care)\s+to\s+(?:answer|discuss|talk|respond|say|do)\b/,
  /\b(?:can'?t|cannot|won'?t|will not|unable to)\s+(?:answer|discuss|say|respond|help|do that|give)\b/,
  /\b(?:no|nope)\b[, ]*(?:i\s+)?(?:can'?t|cannot|don'?t|do not|won'?t)\b/,
  /^(?:no|nope|nothing|pass|skip)\b/,
  /\b(?:skip|pass on)\s+(?:this|that|it|the question)\b/,
  /\bnext question\b/,
  /\b(?:i\s+)?(?:don'?t|do not)\s+know\b/,
  /\bno idea\b/,
  /\bnot (?:sure|comfortable)\b/,
];

/**
 * True when a short answer is a refusal or "I don't know". Asking such a candidate to elaborate
 * only repeats the question; the interview moves on instead.
 */
export function isDecline(text) {
  const t = words(text);
  const n = count(t);
  if (!n || n > MAX_DECLINE_WORDS) return false;
  return DECLINE_PATTERNS.some((pattern) => pattern.test(t));
}
