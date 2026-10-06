// Where a company stands on the Outreach step, and the filters. Pure (also used in the browser),
// so the rules are unit-tested. Relative imports only.
import { CONVERSATION_STATUS } from "./conversation/status";

const isEmailAddress = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());

export const OUTREACH_STATUS = {
  NOT_WRITTEN: "not_written",
  NEEDS_ADDRESS: "needs_address",
  NOT_APPROVED: "not_approved",
  READY: "ready",
  FAILED: "failed",
  WAITING: "waiting",
  REPLIED: "replied",
  MEETING: "meeting",
  CLOSED: "closed",
};

export const OUTREACH_FILTERS = [
  { key: "all", label: "All" },
  { key: "ready", label: "Ready to send", statuses: [OUTREACH_STATUS.READY] },
  { key: "not_approved", label: "Not approved yet", statuses: [OUTREACH_STATUS.NOT_APPROVED, OUTREACH_STATUS.NEEDS_ADDRESS, OUTREACH_STATUS.NOT_WRITTEN] },
  { key: "waiting", label: "Waiting for reply", statuses: [OUTREACH_STATUS.WAITING] },
  { key: "replied", label: "Replied", statuses: [OUTREACH_STATUS.REPLIED] },
  { key: "meeting", label: "Meetings", statuses: [OUTREACH_STATUS.MEETING] },
  { key: "closed", label: "No response / closed", statuses: [OUTREACH_STATUS.CLOSED] },
  { key: "failed", label: "Failed", statuses: [OUTREACH_STATUS.FAILED] },
];

/** Where one company stands, from its latest message and conversation. Pure; unit-tested. */
export function outreachStatus({ lead, message }) {
  const sent = lead.messageSent || message?.status === "sent";
  if (sent) {
    switch (lead.conversationStatus) {
      case CONVERSATION_STATUS.MEETING_BOOKED: return OUTREACH_STATUS.MEETING;
      case CONVERSATION_STATUS.REPLIED:
      case CONVERSATION_STATUS.IN_CONVERSATION:
      case CONVERSATION_STATUS.MEETING_PROPOSED: return OUTREACH_STATUS.REPLIED;
      case CONVERSATION_STATUS.NOT_INTERESTED:
      case CONVERSATION_STATUS.UNSUBSCRIBED:
      case CONVERSATION_STATUS.NO_RESPONSE: return OUTREACH_STATUS.CLOSED;
      default: return OUTREACH_STATUS.WAITING;
    }
  }
  if (!message?.content) return OUTREACH_STATUS.NOT_WRITTEN;
  if (lead.messageError) return OUTREACH_STATUS.FAILED;
  if (message.channel === "email" && !isEmailAddress(message.recipient)) return OUTREACH_STATUS.NEEDS_ADDRESS;
  return message.status === "approved" ? OUTREACH_STATUS.READY : OUTREACH_STATUS.NOT_APPROVED;
}
