import { test } from "node:test";
import assert from "node:assert/strict";
import { summariseCampaigns } from "../../libs/sales/campaign-overview";

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
