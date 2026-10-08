import { test } from "node:test";
import assert from "node:assert/strict";
import { leadStage } from "../../libs/sales/lead-stage";

const company = (over = {}) => ({ company: "Acme", sourceData: {}, messageSent: false, conversationStatus: null, ...over });

test("a company lead moves New → Researched → Fit → Contacted → Replied → Meeting booked", () => {
  assert.equal(leadStage(company(), true).label, "New");
  assert.equal(leadStage(company({ sourceData: { research: {} } }), true).label, "Researched");
  assert.equal(leadStage(company({ sourceData: { research: {}, fit: { score: 72 } } }), true).label, "Fit 72");
  assert.equal(leadStage(company({ messageSent: true, sourceData: { fit: { score: 72 } } }), true).label, "Contacted");
  assert.equal(leadStage(company({ messageSent: true, conversationStatus: "in_conversation" }), true).label, "Replied");
  assert.equal(leadStage(company({ messageSent: true, conversationStatus: "meeting_booked" }), true).label, "Meeting booked");
  assert.equal(leadStage(company({ messageSent: true, conversationStatus: "no_response" }), true).label, "Closed");
});

test("fit colours: strong, possible, poor", () => {
  assert.match(leadStage(company({ sourceData: { fit: { score: 80 } } }), true).tone, /emerald/);
  assert.match(leadStage(company({ sourceData: { fit: { score: 55 } } }), true).tone, /amber/);
  assert.match(leadStage(company({ sourceData: { fit: { score: 30 } } }), true).tone, /rose/);
});

test("a job post without a company name can't become a lead", () => {
  assert.equal(leadStage(company({ company: null }), true).label, "No company");
  assert.equal(leadStage(company({ company: null, sourceData: { company: { name: "Acme" } } }), true).label, "New");
});

test("LinkedIn people: profile read or failed", () => {
  assert.equal(leadStage({ status: "completed", sourceData: {} }, false).label, "Profile read");
  assert.equal(leadStage({ status: "error", sourceData: {} }, false).label, "Read failed");
  assert.equal(leadStage({ status: "pending", sourceData: {} }, false).label, "New");
});
