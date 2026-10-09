// The agent writes its email: an answer from the knowledge base, an offer of meeting times, a
// booking confirmation, or a follow-up. Meeting times and links are never written by the AI: it puts
// {{TIMES}} / {{MEETING}} where they go and the code fills in the exact text. Prompts and the
// placeholder handling are pure (unit-tested). Relative imports only.
import { chatJSON, getFastModel, getModel } from "../../ai/llm";
import { GROUNDING_RULES, normaliseSources } from "../knowledge/answer";
import { formatContext } from "../knowledge/search";
import { formatSlot, slotLines, zoneLabel } from "../meetings/slots";
import { REPLY_PLAN } from "./decide";

const TIMES = "{{TIMES}}";
const MEETING = "{{MEETING}}";

const STYLE = [
  "Write a short, warm, plain email reply: 50-140 words. Match their tone. No subject line.",
  "Start with a one-word or short greeting using their first name if known. No \"I hope this email finds you well\".",
  "Answer exactly what they asked, nothing more. Never use placeholders like [Name] other than the ones you are told to use.",
  "End with the sign-off name alone on the last line.",
];

const PLAN_INSTRUCTIONS = {
  [REPLY_PLAN.ANSWER]: "Answer their questions from the KNOWLEDGE. Then, only if it fits naturally, ask whether a short call would help.",
  [REPLY_PLAN.OFFER]: `Answer any questions from the KNOWLEDGE, then suggest a short call and put the line ${TIMES} on its own line where the available times go (the times are filled in for you; never write times yourself). Ask them to pick one or suggest another time.`,
  [REPLY_PLAN.CONFIRM]: `Confirm the meeting warmly. Put the line ${MEETING} on its own line where the meeting time and link go (filled in for you; never write the time yourself). Say a calendar invite is attached. Answer any questions from the KNOWLEDGE.`,
  [REPLY_PLAN.NOT_NOW]: "Thank them, say you understand, and that you'll be glad to help whenever the timing is right. 2-3 sentences, no pressure, no questions.",
};

function threadLines(thread) {
  return thread.slice(-6).map((m) => `${m.direction === "in" ? "THEM" : "US"}: ${String(m.body).slice(0, 700)}`).join("\n\n");
}

function senderSignOff(senderName) {
  const first = String(senderName || "").trim().split(/\s+/)[0];
  return first ? `Sign off with: ${first}` : "Sign off without a name.";
}

/** @returns {{ system: string, user: string }} */
export function replyPrompt({ plan, reply, reading, thread = [], passages = [], companyName, senderName, timeZone, wrongTime = false, channel = "email" }) {
  const onLinkedIn = channel === "linkedin";
  return {
    system: [
      `You write email replies to clients for ${companyName || "our company"}, continuing a sales conversation.`,
      onLinkedIn ? "This reply is sent as a LinkedIn message, not an email: keep it conversational and a little shorter." : "",
      GROUNDING_RULES,
      ...STYLE,
      // A LinkedIn message can't carry a calendar invite: the time and link are in the text itself
      onLinkedIn && plan === REPLY_PLAN.CONFIRM
        ? PLAN_INSTRUCTIONS[plan].replace(" Say a calendar invite is attached.", " Never mention a calendar invite or an attachment: the time and link in the message are all they need.")
        : PLAN_INSTRUCTIONS[plan],
      wrongTime ? "The time they asked for isn't available: say so briefly and kindly before offering other times." : "",
      `Our time zone is ${zoneLabel(timeZone)}.`,
      senderSignOff(senderName),
      'Return JSON: {"body": "the email", "covered": true|false, "sources": [KNOWLEDGE passage numbers you used]}',
      '"covered" is false if they asked something the KNOWLEDGE does not answer.',
    ].filter(Boolean).join("\n"),
    user: [
      `KNOWLEDGE:\n${formatContext(passages)}`,
      thread.length ? `CONVERSATION SO FAR (oldest first):\n${threadLines(thread)}` : "",
      reading?.questions?.length ? `THEIR QUESTIONS:\n${reading.questions.map((q) => `- ${q}`).join("\n")}` : "",
      reading?.contactName ? `Their first name: ${reading.contactName}` : "",
      `THEIR LATEST REPLY:\n${String(reply).slice(0, 3000)}`,
    ].filter(Boolean).join("\n\n"),
  };
}

/** Fill {{TIMES}} / {{MEETING}} with the exact text; add it if the AI left the placeholder out. */
export function fillPlaceholders(body, { plan, slots = [], meeting = null, timeZone }) {
  let text = String(body || "").trim();
  const insert = (placeholder, block) => {
    if (text.includes(placeholder)) {
      text = text.replace(placeholder, block);
      return;
    }
    // Before the sign-off (the last line)
    const lines = text.split("\n");
    const signOff = lines.length > 1 ? lines.pop() : "";
    text = `${lines.join("\n").trim()}\n\n${block}\n\n${signOff}`.trim();
  };
  if (plan === REPLY_PLAN.OFFER && slots.length) {
    insert(TIMES, `${slotLines(slots, timeZone)}\n(All times ${zoneLabel(timeZone)}.)`);
  }
  if (plan === REPLY_PLAN.CONFIRM && meeting) {
    const lines = [`${formatSlot(meeting.start, timeZone)} ${zoneLabel(timeZone)}, ${meeting.minutes} minutes`];
    if (meeting.link) lines.push(`Join here: ${meeting.link}`);
    insert(MEETING, lines.join("\n"));
  }
  // Never leave a stray placeholder behind
  return text.replace(/ ?\{\{(TIMES|MEETING)\}\}\n?/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

export async function composeReply({ plan, reply, reading, thread, passages, companyName, senderName, timeZone, slots, meeting, wrongTime, channel }) {
  const out = await chatJSON({
    ...replyPrompt({ plan, reply, reading, thread, passages, companyName, senderName, timeZone, wrongTime, channel }),
    model: getModel(),
    temperature: 0.4,
    maxTokens: 1500,
  });
  const sources = normaliseSources(out?.sources, passages.length);
  const asked = (reading?.questions || []).length > 0;
  return {
    body: fillPlaceholders(out?.body, { plan, slots, meeting, timeZone }),
    // Nothing asked means nothing to cover; asked and no passage cited means not covered
    covered: !asked || (Boolean(out?.covered) && sources.length > 0),
    sources,
  };
}

// ─── Follow-ups when they stay quiet ───

/** @returns {{ system: string, user: string }} */
export function followUpPrompt({ number, total, thread, passages = [], companyName, senderName }) {
  const last = number >= total;
  return {
    system: [
      `You write follow-up number ${number} of ${total} for ${companyName || "our company"}: the client hasn't answered our last email in this conversation.`,
      "Follow on from where the conversation stopped (if we offered meeting times, gently ask whether any suits them; don't repeat the times).",
      GROUNDING_RULES,
      "2-4 short sentences, under 80 words. Friendly, never guilt-tripping (no \"just bumping this\", no \"did you see my email\").",
      last
        ? "This is the last one: say you won't keep writing, leave the door open, and keep it gracious."
        : "Add one new, useful reason to talk, taken from the KNOWLEDGE (a relevant service, result or how quickly we can start). End with one easy question.",
      senderSignOff(senderName),
      'Return JSON: {"body": "the email"}',
    ].join("\n"),
    user: [`KNOWLEDGE:\n${formatContext(passages)}`, `CONVERSATION SO FAR (oldest first):\n${threadLines(thread)}`].join("\n\n"),
  };
}

export async function composeFollowUp({ number, total, thread, passages, companyName, senderName }) {
  const out = await chatJSON({ ...followUpPrompt({ number, total, thread, passages, companyName, senderName }), model: getFastModel(), temperature: 0.5, maxTokens: 900 });
  const body = String(out?.body || "").trim();
  if (!body) throw new Error("The AI wrote an empty follow-up");
  return { body };
}
