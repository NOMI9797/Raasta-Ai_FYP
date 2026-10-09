import "../../libs/load-env"; // first: the database client reads DATABASE_URL when it loads
// Integration: a LinkedIn conversation. Our LinkedIn message starts the thread, the person's reply is
// read (browser faked) and recorded once, and the agent answers it from the knowledge base ON LINKEDIN
// (LinkedIn sending faked). Real database, fake AI.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../../libs/db";
import { conversationMessages, leads } from "../../libs/schema";
import { advanceSalesRun } from "../../libs/sales/agent/sales-agent";
import { recordOutbound } from "../../libs/sales/conversation/thread";
import { syncLinkedInReplies } from "../../libs/sales/linkedin-inbox";
import { closeDatabase, createCampaign, createRun, createUser, databaseReady, fakeEmail, fakeNotify, getLead, removeUser, resetLlm, tickUntilIdle, useFakeLlm } from "./helpers/fixtures";

let ready = false;
let user;
before(async () => {
  ready = await databaseReady();
  if (!ready) return;
  user = await createUser({ name: "Nouman Ahmed" });
  useFakeLlm([
    { when: (system) => system.includes("You read a client's reply"), reply: () => ({ intent: "question", questions: ["What do you charge?"], confidence: 0.95, sentiment: "positive", sensitive: false, contactName: "Sara", summary: "asks the price" }) },
    { when: (system) => system.includes("You write email replies"), reply: () => ({ body: "Hi Sara,\n\nA senior developer is from $4,000 per month.\n\nNouman", covered: true, sources: [1] }) },
  ]);
});
after(async () => {
  resetLlm();
  if (user) await removeUser(user.id);
  await closeDatabase();
});

const passages = async () => ({ results: [{ id: "p1", title: "Pricing", category: "pricing", content: "Senior developer from $4,000 per month.", similarity: 0.7 }], topSimilarity: 0.7 });

test("a LinkedIn reply is read once, and the agent answers it on LinkedIn", async (t) => {
  if (!ready) return t.skip("database not reachable");
  const campaign = await createCampaign(user.id, { name: "LinkedIn conversation", sources: ["linkedin"] });
  const profile = "https://www.linkedin.com/in/sara-test";
  const [lead] = await db.insert(leads).values({ userId: user.id, campaignId: campaign.id, source: "linkedin", url: profile, name: "Sara Ahmed", status: "completed", messageSent: true, sourceData: { profile: { name: "Sara Ahmed" } } }).returning();
  await recordOutbound({ lead, kind: "outreach", channel: "linkedin", subject: null, body: "Hi Sara, saw your post.", toAddress: profile, sent: { messageId: null }, followUpDays: [3, 7] });
  assert.equal((await getLead(lead.id)).conversationStatus, "awaiting_reply", "our LinkedIn message starts the conversation");

  // The reader (browser) is faked: Sara wrote one message
  const asked = [];
  const read = async (account, people) => {
    asked.push(...people.map((p) => p.name));
    return [{ leadId: lead.id, messages: [{ urn: "urn:li:msg_message:test-1", text: "Thanks! What do you charge?" }] }];
  };
  const woke = [];
  const first = await syncLinkedInReplies({ id: "acc" }, campaign.id, { read, wake: async (r) => woke.push(r.row.id) });
  assert.deepEqual([first.checked, first.replies, asked], [1, 1, ["Sara Ahmed"]]);
  const again = await syncLinkedInReplies({ id: "acc" }, campaign.id, { read, wake: async () => {} });
  assert.equal(again.replies, 0, "the same LinkedIn message is never recorded twice");
  assert.equal(woke.length, 1);
  assert.equal((await getLead(lead.id)).conversationStatus, "replied");

  // The agent answers in Auto, on LinkedIn, from its account
  const sentOnLinkedIn = [];
  const email = fakeEmail();
  const run = await createRun(user.id, campaign.id, { mode: "autopilot", config: { accountId: "acc" } });
  await tickUntilIdle(advanceSalesRun, run.id, {
    tick: async () => {}, notifyFn: fakeNotify().fn, emailFn: email.send, conversation: { searchFn: passages },
    linkedinRepliesFn: async () => ({ checked: 0, replies: 0 }),
    linkedin: {
      getLinkedInAccount: async () => ({ id: "acc" }), linkedInAllowance: async () => ({ invites: 5, messages: 5 }), checkAcceptances: async () => null,
      sendLinkedInMessage: async (account, msg) => { sentOnLinkedIn.push(msg); return { success: true }; },
    },
  });
  assert.equal(email.sent.length, 0, "no email for a LinkedIn conversation");
  assert.equal(sentOnLinkedIn.length, 1);
  assert.equal(sentOnLinkedIn[0].url, profile);
  assert.match(sentOnLinkedIn[0].message, /\$4,000 per month/);
  const thread = await db.select().from(conversationMessages).where(eq(conversationMessages.leadId, lead.id)).orderBy(conversationMessages.createdAt);
  assert.deepEqual(thread.map((m) => [m.direction, m.channel, m.kind, m.status]), [
    ["out", "linkedin", "outreach", "sent"], ["in", "linkedin", "inbound", "received"], ["out", "linkedin", "reply", "sent"],
  ]);
  assert.equal((await getLead(lead.id)).conversationStatus, "in_conversation");
});
