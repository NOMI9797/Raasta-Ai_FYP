import { test } from "node:test";
import assert from "node:assert/strict";
import { companyPrompt, defaultChannel, personPrompt, pickRecipient } from "../../libs/sales/message-writer";

const research = {
  emails: ["info@acme.pk"],
  contacts: [
    { email: "dev@acme.pk", name: "Bilal Dev", title: "Engineer" },
    { email: "hr@acme.pk", name: "Sara Ahmed", title: "HR Manager" },
  ],
  decisionMakers: [{ name: "Ali Khan", title: "CEO", linkedinUrl: "https://linkedin.com/in/ali" }],
};

test("email goes to a named HR contact first, then any named contact, then the company address", () => {
  assert.equal(pickRecipient(research, "email").address, "hr@acme.pk");
  assert.equal(pickRecipient({ ...research, contacts: [research.contacts[0]] }, "email").address, "dev@acme.pk");
  assert.deepEqual(pickRecipient({ emails: ["info@acme.pk"] }, "email"), { address: "info@acme.pk", name: null, title: null });
  assert.equal(pickRecipient({}, "email"), null);
});

test("LinkedIn goes to the first decision-maker", () => {
  assert.deepEqual(pickRecipient(research, "linkedin"), { address: "https://linkedin.com/in/ali", name: "Ali Khan", title: "CEO" });
  assert.equal(pickRecipient({ decisionMakers: [] }, "linkedin"), null);
});

test("default channel: email if there is an address, LinkedIn if only a person was found", () => {
  assert.equal(defaultChannel(research), "email");
  assert.equal(defaultChannel({ decisionMakers: research.decisionMakers }), "linkedin");
  assert.equal(defaultChannel(null), "email");
});

test("company prompt mentions the open roles, the offer and the recipient", () => {
  const { system, user } = companyPrompt({
    company: "Acme",
    jobs: [{ title: "React Developer" }, { title: "QA Engineer" }],
    research: { description: "Acme builds fintech apps." },
    campaign: { icpConfig: { serviceType: "Staff augmentation" } },
    channel: "email",
    recipient: { name: "Sara Ahmed", title: "HR Manager" },
    senderName: "Nouman",
  });
  assert.match(system, /"subject"/);
  assert.match(user, /React Developer; QA Engineer/);
  assert.match(user, /Staff augmentation/);
  assert.match(user, /Address Sara by first name/);
  assert.match(user, /Acme builds fintech apps/);
});

test("person prompt uses posts when there are some and says so when there are none", () => {
  const withPosts = personPrompt({ lead: { name: "Ali", title: "CTO", company: "Cubix" }, posts: [{ content: "We shipped v2" }], campaign: {} });
  assert.match(withPosts.user, /We shipped v2/);
  assert.match(withPosts.user, /keep the offer general/);
  const without = personPrompt({ lead: { name: "Ali" }, posts: [], campaign: {} });
  assert.match(without.user, /No recent posts/);
});
