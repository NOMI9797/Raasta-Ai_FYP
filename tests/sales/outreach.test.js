import { test } from "node:test";
import assert from "node:assert/strict";
import { OUTREACH_FILTERS, OUTREACH_STATUS, outreachStatus } from "../../libs/sales/outreach-status";

const email = (over = {}) => ({ content: "Hi", channel: "email", recipient: "hr@acme.test", status: "draft", ...over });

test("before sending: not written, needs an address, draft, ready, failed", () => {
  assert.equal(outreachStatus({ lead: {}, message: null }), OUTREACH_STATUS.NOT_WRITTEN);
  assert.equal(outreachStatus({ lead: {}, message: email({ recipient: null }) }), OUTREACH_STATUS.NEEDS_ADDRESS);
  assert.equal(outreachStatus({ lead: {}, message: email({ recipient: "not-an-email" }) }), OUTREACH_STATUS.NEEDS_ADDRESS);
  assert.equal(outreachStatus({ lead: {}, message: email() }), OUTREACH_STATUS.NOT_APPROVED);
  assert.equal(outreachStatus({ lead: {}, message: email({ status: "approved" }) }), OUTREACH_STATUS.READY);
  assert.equal(outreachStatus({ lead: { messageError: "SMTP down" }, message: email({ status: "approved" }) }), OUTREACH_STATUS.FAILED);
});

test("after sending, the conversation decides the status", () => {
  const sent = (conversationStatus) => outreachStatus({ lead: { messageSent: true, conversationStatus }, message: email({ status: "sent" }) });
  assert.equal(sent("awaiting_reply"), OUTREACH_STATUS.WAITING);
  assert.equal(sent(null), OUTREACH_STATUS.WAITING);
  assert.equal(sent("replied"), OUTREACH_STATUS.REPLIED);
  assert.equal(sent("in_conversation"), OUTREACH_STATUS.REPLIED);
  assert.equal(sent("meeting_proposed"), OUTREACH_STATUS.REPLIED);
  assert.equal(sent("meeting_booked"), OUTREACH_STATUS.MEETING);
  for (const s of ["not_interested", "unsubscribed", "no_response"]) assert.equal(sent(s), OUTREACH_STATUS.CLOSED, s);
});

test("every status belongs to exactly one filter (besides All)", () => {
  for (const status of Object.values(OUTREACH_STATUS)) {
    const homes = OUTREACH_FILTERS.filter((f) => f.statuses?.includes(status));
    assert.equal(homes.length, 1, status);
  }
});
