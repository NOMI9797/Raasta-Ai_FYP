// How a researched company is contacted (libs/sales/contact-route.js): the sorting step after research.
// Asked for after the end-to-end run of 9 Oct 2026, where ~60% of Rozee.pk companies had no email.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTACT_ROUTE, contactRoute, defaultChannel, pickRecipient } from "../../libs/sales/contact-route";

const lead = (research) => ({ id: "x", source: "rozee", company: "Acme", sourceData: research === undefined ? {} : { research } });
const ali = { name: "Ali Khan", title: "CEO", linkedinUrl: "https://www.linkedin.com/in/ali" };

test("an address goes to Email, a decision-maker only to LinkedIn, nothing to No contact", () => {
  assert.equal(contactRoute(lead({ emails: ["hr@acme.pk"], decisionMakers: [ali] })), CONTACT_ROUTE.EMAIL, "email wins when both are found");
  assert.equal(contactRoute(lead({ emails: [], decisionMakers: [ali] })), CONTACT_ROUTE.LINKEDIN);
  assert.equal(contactRoute(lead({ emails: [], phones: ["+924235000000"], decisionMakers: [] })), CONTACT_ROUTE.NO_CONTACT, "a phone number alone isn't a channel the agent writes on");
  assert.equal(contactRoute(lead(undefined)), null, "not researched yet");
});

test("a message that already has somewhere to go keeps its channel; an unaddressed email follows the research", () => {
  const li = lead({ emails: [], decisionMakers: [ali] });
  assert.equal(contactRoute(li, { channel: "email", recipient: "typed@acme.pk" }), CONTACT_ROUTE.EMAIL, "an address typed by hand");
  assert.equal(contactRoute(lead({ emails: ["hr@acme.pk"], decisionMakers: [ali] }), { channel: "linkedin", recipient: ali.linkedinUrl }), CONTACT_ROUTE.LINKEDIN, "switched to LinkedIn by hand");
  assert.equal(contactRoute(li, { channel: "email", recipient: null }), CONTACT_ROUTE.LINKEDIN);
  assert.equal(contactRoute(lead({ emails: [] }), { channel: "email", recipient: "" }), CONTACT_ROUTE.NO_CONTACT);
});

test("recipients: named HR or leadership contacts first, a profile only with a link, junk addresses ignored", () => {
  const research = { emails: ["info@acme.pk"], contacts: [{ name: "Sana", title: "Developer", email: "sana@acme.pk" }, { name: "Omar", title: "HR Manager", email: "omar@acme.pk" }], decisionMakers: [{ name: "No Link" }, ali] };
  assert.equal(pickRecipient(research, "email").address, "omar@acme.pk");
  assert.equal(pickRecipient(research, "linkedin").address, ali.linkedinUrl, "the first person with a profile link");
  assert.equal(pickRecipient({ emails: ["not an email"] }, "email"), null);
  assert.equal(defaultChannel({ emails: ["not an email"], decisionMakers: [{ name: "No Link" }] }), null);
});
