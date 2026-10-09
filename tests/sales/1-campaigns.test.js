// Campaigns (step 1): campaign cards, lead stages and the setup guide.
// Combined from the section's test files; each keeps its own setup inside its describe block.
// Run: npm run test:sales:campaigns   (or: npx tsx --test tests/sales/1-campaigns.test.js)
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { summariseCampaigns } from "../../libs/sales/campaign-overview";
import { buildSalesGuidance } from "../../libs/sales/guidance";
import { leadStage } from "../../libs/sales/lead-stage";

// ─── Campaign cards (was campaign-overview.test.js) ───
describe("Campaign cards", () => {
  test("each campaign card gets leads by platform, contacted, replied and meetings", () => {
    const out = summariseCampaigns({
      leads: [
        { campaignId: "c1", source: "indeed", messageSent: true, conversationStatus: "meeting_booked" },
        { campaignId: "c1", source: "indeed", messageSent: true, conversationStatus: "awaiting_reply" },
        { campaignId: "c1", source: "linkedin", messageSent: false, conversationStatus: null },
        { campaignId: "c2", source: null, messageSent: true, conversationStatus: "not_interested" },
      ],
      meetings: [
        { campaignId: "c1", leadId: "a", status: "confirmed" },
        { campaignId: "c1", leadId: "a", status: "completed" }, // same lead: one meeting
        { campaignId: "c1", leadId: "b", status: "proposed" },  // only offered: not counted
      ],
    });
    assert.deepEqual(out.c1, { leads: 3, byPlatform: { indeed: 2, linkedin: 1 }, contacted: 2, replied: 1, meetings: 1, agent: null });
    assert.deepEqual(out.c2.byPlatform, { linkedin: 1 }, "no source means LinkedIn");
    assert.equal(out.c2.replied, 1, "a 'no' is still a reply");
  });

  test("the newest active agent run is the campaign's agent; finished runs are ignored", () => {
    const out = summariseCampaigns({
      runs: [
        { campaignId: "c1", status: "waiting", mode: "autopilot" },
        { campaignId: "c1", status: "completed", mode: "assisted" },
        { campaignId: "c2", status: "cancelled", mode: "assisted" },
      ],
    });
    assert.deepEqual(out.c1.agent, { status: "waiting", mode: "autopilot" });
    assert.equal(out.c2.agent, null);
  });
});

// ─── Lead stages (was lead-stage.test.js) ───
describe("Lead stages", () => {
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
});

// ─── Setup guide (was guidance.test.js) ───
describe("Setup guide", () => {
  const empty = { linkedinAccounts: 0, rozeeAccounts: 0, campaigns: 0, leads: 0, researchedLeads: 0, messages: 0, contactedLeads: 0, salesAgents: 0 };

  test("a new user is pointed at connecting LinkedIn first", () => {
    const { next, steps } = buildSalesGuidance(empty);
    assert.equal(next.id, "linkedin");
    assert.ok(steps.every((s) => !s.done));
  });

  test("optional steps never become the next step", () => {
    const counts = { ...empty, linkedinAccounts: 1, campaigns: 1, leads: 3, researchedLeads: 3, messages: 3, contactedLeads: 1 };
    const { next, steps } = buildSalesGuidance(counts, { indeedReady: false });
    assert.equal(next, null);
    assert.equal(steps.find((s) => s.id === "job-boards").done, false);
    assert.equal(steps.find((s) => s.id === "agent").done, false);
  });

  test("the first unfinished required step is next", () => {
    const { next } = buildSalesGuidance({ ...empty, linkedinAccounts: 1, campaigns: 2 });
    assert.equal(next.id, "leads");
  });

  test("job boards are done when Indeed is set up and Rozee.pk can be searched reliably (Serper)", () => {
    const step = (opts) => buildSalesGuidance(empty, opts).steps.find((s) => s.id === "job-boards");
    assert.equal(step({ indeedReady: true, searchProvider: "serper" }).done, true);
    assert.equal(step({ indeedReady: true, searchProvider: "duckduckgo" }).done, false);
    assert.match(step({ indeedReady: true, searchProvider: "duckduckgo" }).detail, /SERPER_API_KEY/);
    assert.equal(step({ indeedReady: false, searchProvider: "serper" }).done, false);
    assert.doesNotMatch(step({ indeedReady: true }).detail, /Connect a Rozee/, "no Rozee.pk account is needed any more");
  });
});
