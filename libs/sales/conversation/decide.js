// What the agent does with a reply, from its reading. Pure, so every rule is unit-tested.
// The AI only reads and writes; these rules decide whether to answer, offer times, book, wait or stop,
// and when a person has to look first. Relative imports only.
import { CONVERSATION_STATUS, INTENT } from "./status";

export const REPLY_PLAN = {
  ANSWER: "answer",   // answer from the knowledge base
  OFFER: "offer",     // answer, and offer meeting times
  CONFIRM: "confirm", // book the time they chose and confirm it
  NOT_NOW: "not_now", // thank them, close for now
  CLOSE: "close",     // no reply: they declined or asked us to stop
  WAIT: "wait",       // out of office: follow up when they're back
};

export const REPLY_ESCALATION = {
  NOT_IN_KNOWLEDGE: "not_in_knowledge",
  SENSITIVE: "sensitive",
  NEGATIVE: "negative",
  UNCLEAR: "unclear",
  TIME_UNAVAILABLE: "time_unavailable",
};

export const REPLY_ESCALATION_LABELS = {
  not_in_knowledge: "They asked something the knowledge base doesn't answer",
  sensitive: "Pricing, contract or legal terms: a person should check",
  negative: "The client sounds unhappy",
  unclear: "The agent isn't sure what they want",
  time_unavailable: "The time they asked for isn't free: other times were offered",
};

const DAY_MS = 24 * 3600 * 1000;
export const MIN_CONFIDENCE = 0.6;

/**
 * @param reading   normaliseReading() output
 * @param proposed  { start: Date, free: boolean }: the offered time they picked, or a time they
 *                  suggested (see proposedTime), or null
 * @returns {{ plan, send, nextStatus, escalations, start?, followUpAt? }}
 */
export function planReply({ reading, proposed = null, now = new Date() }) {
  const escalations = [];
  if (reading.confidence < MIN_CONFIDENCE || reading.intent === INTENT.OTHER) escalations.push(REPLY_ESCALATION.UNCLEAR);
  if (reading.sentiment === "negative" && ![INTENT.NOT_INTERESTED, INTENT.UNSUBSCRIBE, INTENT.NOT_NOW].includes(reading.intent)) escalations.push(REPLY_ESCALATION.NEGATIVE);
  if (reading.sensitive) escalations.push(REPLY_ESCALATION.SENSITIVE);

  const offer = () => ({ plan: REPLY_PLAN.OFFER, send: true, nextStatus: CONVERSATION_STATUS.MEETING_PROPOSED, escalations });
  const confirm = (start) => ({ plan: REPLY_PLAN.CONFIRM, send: true, nextStatus: CONVERSATION_STATUS.MEETING_BOOKED, escalations, start: new Date(start) });
  const byTime = () => {
    if (!proposed) return offer();
    if (proposed.free) return confirm(proposed.start);
    escalations.push(REPLY_ESCALATION.TIME_UNAVAILABLE);
    return offer();
  };

  switch (reading.intent) {
    case INTENT.UNSUBSCRIBE:
      return { plan: REPLY_PLAN.CLOSE, send: false, nextStatus: CONVERSATION_STATUS.UNSUBSCRIBED, escalations: [] };
    case INTENT.NOT_INTERESTED:
      return { plan: REPLY_PLAN.CLOSE, send: false, nextStatus: CONVERSATION_STATUS.NOT_INTERESTED, escalations: [] };
    case INTENT.OUT_OF_OFFICE: {
      const back = reading.returnDate ? new Date(`${reading.returnDate}T09:00:00Z`) : null;
      const followUpAt = back && back > now ? new Date(back.getTime() + DAY_MS) : new Date(now.getTime() + 5 * DAY_MS);
      return { plan: REPLY_PLAN.WAIT, send: false, nextStatus: CONVERSATION_STATUS.AWAITING_REPLY, escalations: [], followUpAt };
    }
    case INTENT.NOT_NOW:
      return { plan: REPLY_PLAN.NOT_NOW, send: true, nextStatus: CONVERSATION_STATUS.NOT_INTERESTED, escalations };
    case INTENT.PICK_SLOT:
    case INTENT.MEETING:
    case INTENT.RESCHEDULE:
      return byTime();
    case INTENT.INTERESTED:
      return byTime(); // a time if they gave one, otherwise we offer some
    case INTENT.QUESTION:
      if (proposed) return byTime(); // a question and a time: answer it and book the time
      return { plan: REPLY_PLAN.ANSWER, send: true, nextStatus: CONVERSATION_STATUS.IN_CONVERSATION, escalations };
    case INTENT.OTHER:
    default:
      return { plan: REPLY_PLAN.ANSWER, send: true, nextStatus: CONVERSATION_STATUS.IN_CONVERSATION, escalations };
  }
}

/**
 * The time a reply points at: one of the offered slots they picked, else a time they suggested
 * (in their time zone when they named one, otherwise ours). Returns a Date or null.
 */
export function proposedTime(reading, { offeredSlots = [], timeZone, zonedTime }) {
  if (reading.chosenSlot && offeredSlots[reading.chosenSlot - 1]) return new Date(offeredSlots[reading.chosenSlot - 1].start);
  if (!reading.proposedStart) return null;
  const [date, time] = reading.proposedStart.split("T");
  return zonedTime(date, time, reading.proposedTimeZone || timeZone);
}

/** Where our answer goes: their address, or the original recipient while test mode redirects mail. */
export function replyAddress(thread, { testRecipient = null } = {}) {
  const lastIn = [...thread].reverse().find((m) => m.direction === "in" && m.fromAddress);
  const firstOut = thread.find((m) => m.direction === "out" && m.toAddress);
  const from = lastIn?.fromAddress?.toLowerCase();
  if (from && from !== String(testRecipient || "").toLowerCase()) return lastIn.fromAddress;
  return firstOut?.toAddress || lastIn?.fromAddress || null;
}
