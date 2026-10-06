// Where a lead's conversation stands after the first message, and what the client wants in a reply.
// Shared by the inbox sync, the agent and the Conversations page. Pure; relative imports only.

export const CONVERSATION_STATUS = {
  AWAITING_REPLY: "awaiting_reply",     // we wrote; follow-ups are due if they stay quiet
  REPLIED: "replied",                   // they wrote; the agent hasn't answered yet
  IN_CONVERSATION: "in_conversation",   // we answered; waiting for them again
  MEETING_PROPOSED: "meeting_proposed", // we offered times
  MEETING_BOOKED: "meeting_booked",
  NOT_INTERESTED: "not_interested",
  UNSUBSCRIBED: "unsubscribed",
  NO_RESPONSE: "no_response",           // follow-ups used up, no answer
};

export const CONVERSATION_LABELS = {
  awaiting_reply: { label: "Waiting for a reply", tone: "badge-ghost" },
  replied: { label: "Replied", tone: "badge-info" },
  in_conversation: { label: "In conversation", tone: "badge-info" },
  meeting_proposed: { label: "Times offered", tone: "badge-warning" },
  meeting_booked: { label: "Meeting booked", tone: "badge-success" },
  not_interested: { label: "Not interested", tone: "badge-ghost" },
  unsubscribed: { label: "Unsubscribed", tone: "badge-ghost" },
  no_response: { label: "No response", tone: "badge-ghost" },
};

// The conversation is over: no follow-ups, no replies from the agent
export const CLOSED_STATUSES = [CONVERSATION_STATUS.NOT_INTERESTED, CONVERSATION_STATUS.UNSUBSCRIBED, CONVERSATION_STATUS.NO_RESPONSE, CONVERSATION_STATUS.MEETING_BOOKED];

// What the client wants, as the agent reads their reply
export const INTENT = {
  QUESTION: "question",
  INTERESTED: "interested",
  MEETING: "meeting",           // wants to talk, or suggests a time
  PICK_SLOT: "pick_slot",       // chooses one of the times we offered
  RESCHEDULE: "reschedule",
  NOT_NOW: "not_now",
  NOT_INTERESTED: "not_interested",
  UNSUBSCRIBE: "unsubscribe",
  OUT_OF_OFFICE: "out_of_office",
  OTHER: "other",
};

export const INTENT_LABELS = {
  question: "Asked a question",
  interested: "Interested",
  meeting: "Wants a meeting",
  pick_slot: "Picked a time",
  reschedule: "Wants another time",
  not_now: "Not right now",
  not_interested: "Not interested",
  unsubscribe: "Asked to stop",
  out_of_office: "Out of office",
  other: "Other",
};

export function conversationLabel(status) {
  return CONVERSATION_LABELS[status] || { label: status || "Not contacted", tone: "badge-ghost" };
}
