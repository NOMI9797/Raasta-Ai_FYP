import "../../libs/load-env"; // first: the database client reads DATABASE_URL when it loads
// Integration: a Rozee.pk campaign end to end against the real database. The agent searches
// Rozee.pk (search engine replaced by the real results in tests/fixtures), imports one lead per
// company, prepares and emails them. Email and the AI steps are fakes; nothing is sent.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { and, eq } from "drizzle-orm";
import { db } from "../../libs/db";
import { agentActions, leads, messages } from "../../libs/schema";
import { advanceSalesRun } from "../../libs/sales/agent/sales-agent";
import { sanitiseSalesConfig, startSalesRun } from "../../libs/sales/agent/launch";
import { searchRozeeJobPosts } from "../../libs/sales/rozee-search";
import { closeDatabase, createCampaign, createRun, createUser, databaseReady, fakeEmail, removeUser, tickUntilIdle } from "./helpers/fixtures";

const RESULTS = JSON.parse(readFileSync(new URL("../fixtures/sales/rozee-search-results.json", import.meta.url), "utf8"));
let ready = false;
let user;
before(async () => {
  ready = await databaseReady();
  if (ready) user = await createUser();
});
after(async () => {
  if (user) await removeUser(user.id);
  await closeDatabase();
});

test("the agent finds companies on Rozee.pk, adds them and emails the good fits", async (t) => {
  if (!ready) return t.skip("database not reachable");
  const campaign = await createCampaign(user.id, { name: "Rozee test", sources: ["rozee"] });
  const run = await createRun(user.id, campaign.id, { mode: "autopilot", config: { search: { platform: "rozee", query: "react developer", location: "Lahore", limit: 10 } } });
  const email = fakeEmail();
  const searched = [];
  const deps = {
    tick: async () => {},
    notifyFn: async () => {},
    emailFn: email.send,
    searchFn: async (filters) => {
      searched.push(filters);
      return { success: true, results: await searchRozeeJobPosts(filters, { search: async () => RESULTS }) };
    },
    researchFn: async (lead) => {
      const research = { status: "found", emails: [`hr@${lead.company.toLowerCase().replace(/[^a-z]/g, "")}.test`] };
      const [updated] = await db.update(leads).set({ sourceData: { ...lead.sourceData, research } }).where(eq(leads.id, lead.id)).returning();
      return updated;
    },
    scoreFn: async ({ lead }) => ({ score: lead.company === "Terasols" ? 20 : 75, reason: "test", model: "fake", scoredAt: new Date().toISOString() }),
    writeFn: async ({ lead, userId }) => {
      const [message] = await db.insert(messages).values({
        userId, leadId: lead.id, campaignId: lead.campaignId, source: "rozee", channel: "email", status: "draft", model: "fake",
        recipient: lead.sourceData.research.emails[0], subject: `About your ${lead.title} role`, content: "Hi,\n\nWe can help.\n\nTest",
      }).returning();
      return { message };
    },
  };

  await tickUntilIdle(advanceSalesRun, run.id, deps);

  assert.equal(searched[0].platform, "rozee", "the agent searched Rozee.pk, not Indeed");
  const rows = await db.select().from(leads).where(eq(leads.campaignId, campaign.id));
  assert.ok(rows.every((l) => l.source === "rozee"));
  // Lahore posts with a company: Dextrologix, Terasols, Systems Ltd, Alphabet Global, Veysel, Tecaudex
  const companies = rows.map((l) => l.company).filter(Boolean).sort();
  assert.deepEqual(companies, ["Alphabet Global", "Dextrologix (Pvt.) Ltd", "Systems Ltd", "Tecaudex", "Terasols", "Veysel Enterprises"]);

  const [find] = await db.select().from(agentActions).where(and(eq(agentActions.agentRunId, run.id), eq(agentActions.action, "find_leads")));
  assert.match(find.summary, /^Searched Rozee\.pk for "react developer in Lahore"/);

  assert.equal(email.sent.length, 5, "every good fit emailed; Terasols (fit 20) skipped");
  assert.ok(!email.sent.some((e) => e.to.includes("terasols")));
});

test("a Rozee.pk search needs a campaign that takes Rozee.pk leads", async (t) => {
  if (!ready) return t.skip("database not reachable");
  assert.equal(sanitiseSalesConfig({ campaignId: "x", search: { platform: "rozee", query: "qa" } }).search.platform, "rozee");
  assert.equal(sanitiseSalesConfig({ campaignId: "x", search: { platform: "monster", query: "qa" } }).search.platform, "indeed", "unknown boards fall back to Indeed");
  const indeedOnly = await createCampaign(user.id, { name: "Indeed only", sources: ["indeed"] });
  await assert.rejects(
    startSalesRun({ user, mode: "full_auto", config: { campaignId: indeedOnly.id, search: { platform: "rozee", query: "qa" } } }),
    /doesn't take Rozee\.pk leads/,
  );
});
