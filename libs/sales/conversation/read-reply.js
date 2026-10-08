// The agent reads a client's reply: what they want, what they asked, a time they suggested.
// Prompt and normalisation are pure (unit-tested); readReply calls the fast model. Relative imports only.
import { chatJSON, getFastModel } from "../../ai/llm";
import { INTENT } from "./status";
import { formatSlot, localDate, zoneLabel } from "../meetings/slots";

const INTENTS = Object.values(INTENT);
const SENTIMENTS = ["positive", "neutral", "negative"];

/** @returns {{ system: string, user: string }} */
export function readReplyPrompt({ reply, ourLastEmail, offeredSlots = [], timeZone, now = new Date() }) {
  const today = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);
  return {
    system: [
      "You read a client's reply to our B2B sales email and report what they want. Report only; don't write a reply.",
      `intent, one of: ${INTENTS.join(", ")}.`,
      "- question: they ask about our services, prices, process, etc.",
      "- interested: positive, wants to know more or move forward, no specific question",
      "- meeting: wants a call/meeting, or suggests a time",
      "- pick_slot: chooses one of the times we offered (give its number in chosenSlot)",
      "- reschedule: wants to move a meeting that was already agreed",
      "- not_now: maybe later, no budget now, contact again in a few months",
      "- not_interested: declines",
      "- unsubscribe: asks us to stop emailing / remove them",
      "- out_of_office: an automatic away reply",
      "- other: anything else",
      "questions: each question they ask, rewritten to stand alone (\"How much does a Flutter app cost?\"). Empty if none.",
      "sensitive: true only when they negotiate (ask for a discount, a lower price, a custom deal), ask for contract, legal, payment or guarantee terms beyond a simple question, or complain. Simply asking what something costs, or about an NDA, is NOT sensitive.",
      `proposedStart: a specific time they suggest, as local "YYYY-MM-DDTHH:MM", resolved against today's date. null if none or vague ("next week").`,
      "proposedTimeZone: the IANA time zone of that time if they say it (\"UK time\" → Europe/London), else null.",
      "returnDate: for out_of_office, the date they're back as \"YYYY-MM-DD\", else null.",
      "contactName: the first name they sign with, else null.",
      "confidence: 0 to 1, how sure you are about intent.",
      'Return JSON: {"intent": "", "confidence": 0.0, "sentiment": "positive|neutral|negative", "questions": [], "sensitive": false, "sensitiveReason": null, "proposedStart": null, "proposedTimeZone": null, "chosenSlot": null, "returnDate": null, "contactName": null, "summary": "one short sentence"}',
    ].join("\n"),
    user: [
      `Today is ${today}. Our time zone: ${zoneLabel(timeZone, now)} (${timeZone}).`,
      offeredSlots.length ? `Times we offered:\n${offeredSlots.map((s, i) => `${i + 1}. ${formatSlot(s.start, timeZone)}`).join("\n")}` : "We have not offered meeting times.",
      ourLastEmail ? `OUR LAST EMAIL:\n${String(ourLastEmail).slice(0, 1500)}` : "",
      `THEIR REPLY:\n${String(reply).slice(0, 4000)}`,
    ].filter(Boolean).join("\n\n"),
  };
}

const isDateTime = (v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(v || "").slice(0, 16));

/** Clean the model's reading; anything unusable becomes null / a safe default. */
export function normaliseReading(out, { offeredCount = 0 } = {}) {
  const intent = INTENTS.includes(out?.intent) ? out.intent : INTENT.OTHER;
  const chosen = Number(out?.chosenSlot);
  return {
    intent,
    confidence: Math.max(0, Math.min(1, Number(out?.confidence) || 0)),
    sentiment: SENTIMENTS.includes(out?.sentiment) ? out.sentiment : "neutral",
    questions: (Array.isArray(out?.questions) ? out.questions : []).map((q) => String(q).trim()).filter(Boolean).slice(0, 6),
    sensitive: Boolean(out?.sensitive),
    sensitiveReason: out?.sensitive ? String(out?.sensitiveReason || "").slice(0, 200) || null : null,
    proposedStart: isDateTime(out?.proposedStart) ? String(out.proposedStart).slice(0, 16) : null,
    proposedTimeZone: typeof out?.proposedTimeZone === "string" && out.proposedTimeZone.includes("/") ? out.proposedTimeZone : null,
    chosenSlot: Number.isInteger(chosen) && chosen >= 1 && chosen <= offeredCount ? chosen : null,
    returnDate: /^\d{4}-\d{2}-\d{2}$/.test(String(out?.returnDate || "")) ? out.returnDate : null,
    contactName: String(out?.contactName || "").trim().split(/\s+/)[0]?.slice(0, 40) || null,
    summary: String(out?.summary || "").slice(0, 300),
  };
}

export async function readReply({ reply, ourLastEmail, offeredSlots = [], timeZone, now = new Date() }) {
  const out = await chatJSON({ ...readReplyPrompt({ reply, ourLastEmail, offeredSlots, timeZone, now }), model: getFastModel(), temperature: 0, maxTokens: 900 });
  return normaliseReading(out, { offeredCount: offeredSlots.length });
}

export { localDate };
