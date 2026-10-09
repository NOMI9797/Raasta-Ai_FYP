// Messages (step 4): the AI message writer and moving a company to Email or LinkedIn.
// Combined from the section's test files; each keeps its own setup inside its describe block.
// Run: npm run test:sales:messages   (or: npx tsx --test tests/sales/4-messages.test.js)
import "../../libs/load-env"; // first: the database client reads DATABASE_URL when it loads
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../../libs/db";
import { contactRoute } from "../../libs/sales/contact-route";
import { addCompanyContact, LeadActionError, writeLeadMessage } from "../../libs/sales/lead-actions";
import * as MW from "../../libs/sales/message-writer";
import { companyPrompt, defaultChannel, personPrompt, pickRecipient } from "../../libs/sales/message-writer";
import { leads, messages } from "../../libs/schema";
import { closeDatabase, createCampaign, createCompanyLead, createUser, databaseReady, removeUser, resetLlm, useFakeLlm } from "./helpers/fixtures";

// ─── Message writer (was message-writer.test.js) ───
describe("Message writer", () => {
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
    assert.deepEqual(pickRecipient(research, "linkedin"), { address: "https://www.linkedin.com/in/ali", name: "Ali Khan", title: "CEO" });
    assert.equal(pickRecipient({ decisionMakers: [] }, "linkedin"), null);
  });

  test("default channel: email if there is an address, LinkedIn if only a person was found", () => {
    assert.equal(defaultChannel(research), "email");
    assert.equal(defaultChannel({ decisionMakers: research.decisionMakers }), "linkedin");
    assert.equal(defaultChannel(null), null, "no contact: nothing is written");
    assert.equal(defaultChannel({ emails: [], decisionMakers: [] }), null);
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

  test("with no offer on the campaign, messages use our services from the knowledge base and write as the seller (LinkedIn test)", () => {
    const { offerContext, personPrompt } = MW;
    const ours = { name: "Raasta Tech Solutions", services: "Custom web development, maintenance and dedicated developers." };
    const ctx = offerContext({ description: "fwhf", icpConfig: {} }, ours);
    assert.match(ctx, /Our company: Raasta Tech Solutions/);
    assert.match(ctx, /What we offer \(from our knowledge base\): Custom web development/);
    assert.doesNotMatch(ctx, /fwhf/, "a scribble isn't treated as campaign notes");
    // The campaign's own offer wins
    assert.match(offerContext({ icpConfig: { serviceType: "Flutter apps" } }, ours), /What we offer: Flutter apps/);
    const { system } = personPrompt({ lead: { name: "Nouman Ahmed" }, campaign: {}, company: ours });
    assert.match(system, /You are the seller/);
  });
});

// ─── Move to Email / LinkedIn (database) (was contact.integration.test.js) ───
// Integration: moving a company out of "No contact" (Messages step). A person adds the email address or
// LinkedIn profile research couldn't find; it is saved on the company and the message is written for it.
// The AI is faked; the database is real.
describe("Move to Email / LinkedIn (database)", () => {
  let ready = false;
  let user;
  let campaign;
  before(async () => {
    ready = await databaseReady();
    if (!ready) return;
    user = await createUser();
    campaign = await createCampaign(user.id, { name: "Contact test", sources: ["rozee"] });
    useFakeLlm([
      { when: (system) => /LinkedIn message/.test(system), reply: () => ({ body: "Hi Sara, saw you're hiring React developers. Happy to help." }) },
      { when: () => true, reply: () => ({ subject: "Your React hiring", body: "Hi team,\n\nWe can help with your React roles.\n\nThanks" }) },
    ]);
  });
  after(async () => {
    resetLlm();
    if (user) await removeUser(user.id);
  });

  const noContactLead = (company) =>
    createCompanyLead(user.id, campaign.id, { company, sourceData: { research: { status: "partial", website: "https://example.pk", emails: [], phones: ["+924235000000"], decisionMakers: [] } } });

  test("a company with no contact gets no message written", async (t) => {
    if (!ready) return t.skip("database not reachable");
    const lead = await noContactLead("Quiet Co");
    assert.equal(contactRoute(lead), "no_contact");
    await assert.rejects(() => writeLeadMessage({ lead, userId: user.id }), (e) => e instanceof LeadActionError && e.code === "no_contact");
    assert.equal((await db.select().from(messages).where(eq(messages.leadId, lead.id))).length, 0);
  });

  test("Move to Email: the address is saved and an email to it is written", async (t) => {
    if (!ready) return t.skip("database not reachable");
    const lead = await noContactLead("Mail Me Ltd");
    const { lead: updated, message } = await addCompanyContact(lead, user.id, { channel: "email", address: " HR@MailMe.pk " });
    assert.deepEqual([message.channel, message.recipient, message.status], ["email", "hr@mailme.pk", "draft"]);
    assert.equal(message.subject, "Your React hiring");
    assert.deepEqual(updated.sourceData.research.emails, ["hr@mailme.pk"]);
    assert.deepEqual(updated.sourceData.research.addedByYou.emails, ["hr@mailme.pk"], "remembered, so a new research run keeps it");
    assert.equal(contactRoute(updated, message), "email");
  });

  test("Move to LinkedIn: the profile is saved as a decision-maker and a LinkedIn message is written", async (t) => {
    if (!ready) return t.skip("database not reachable");
    const lead = await noContactLead("Profile Co");
    const { lead: updated, message } = await addCompanyContact(lead, user.id, { channel: "linkedin", address: "https://pk.linkedin.com/in/sara-ahmed?trk=x", name: "Sara Ahmed", title: "CEO" });
    assert.deepEqual([message.channel, message.recipient], ["linkedin", "https://www.linkedin.com/in/sara-ahmed"], "the message goes to the clean profile link");
    assert.match(message.content, /Hi Sara/);
    assert.deepEqual(updated.sourceData.research.decisionMakers[0], { name: "Sara Ahmed", title: "CEO", linkedinUrl: "https://pk.linkedin.com/in/sara-ahmed", addedByYou: true });
    assert.equal(contactRoute(updated, message), "linkedin");
  });

  test("bad contacts are refused and nothing changes", async (t) => {
    if (!ready) return t.skip("database not reachable");
    const lead = await noContactLead("Strict Co");
    await assert.rejects(() => addCompanyContact(lead, user.id, { channel: "email", address: "not-an-email" }), /valid email/);
    await assert.rejects(() => addCompanyContact(lead, user.id, { channel: "linkedin", address: "https://www.linkedin.com/company/strict" }), /profile link/);
    const [same] = await db.select().from(leads).where(eq(leads.id, lead.id));
    assert.deepEqual(same.sourceData.research.emails, []);
  });
});

// One database connection for the whole file: closed after every section has run
after(async () => {
  await closeDatabase();
});
