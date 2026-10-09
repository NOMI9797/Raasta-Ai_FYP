import "../../libs/load-env"; // first: the database client reads DATABASE_URL when it loads
// Integration: moving a company out of "No contact" (Messages step). A person adds the email address or
// LinkedIn profile research couldn't find; it is saved on the company and the message is written for it.
// The AI is faked; the database is real.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../../libs/db";
import { leads, messages } from "../../libs/schema";
import { LeadActionError, addCompanyContact, writeLeadMessage } from "../../libs/sales/lead-actions";
import { contactRoute } from "../../libs/sales/contact-route";
import { closeDatabase, createCampaign, createCompanyLead, createUser, databaseReady, removeUser, resetLlm, useFakeLlm } from "./helpers/fixtures";

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
  await closeDatabase();
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
