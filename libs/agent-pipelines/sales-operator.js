import { campaigns, leads, messages } from "@/libs/schema";
import { eq, and, desc, count } from "drizzle-orm";
import { generatePersonalizedMessage } from "@/libs/groq-service";

export const salesOperatorPipeline = {
  steps: [
    {
      key: "create_campaign",
      label: "Create Campaign",
      isCheckpoint: false,
      async execute(ctx) {
        const c = ctx.config.campaignDefaults || {};

        const [campaign] = await ctx.db
          .insert(campaigns)
          .values({
            userId: ctx.userId,
            name: c.name || "Agent Campaign",
            description: c.description || "Created by AI agent",
            icpConfig: c.icpConfig || null,
            status: "active",
          })
          .returning();

        return { campaignId: campaign.id, name: campaign.name };
      },
    },
    {
      key: "add_leads",
      label: "Import Leads",
      isCheckpoint: false,
      async execute(ctx) {
        const { campaignId } = ctx.stepOutputs.create_campaign;
        const leadUrls = ctx.config.leadUrls || [];

        if (!leadUrls.length) {
          return { campaignId, added: 0, note: "No lead URLs provided in config" };
        }

        const inserted = [];
        for (const url of leadUrls) {
          const [lead] = await ctx.db
            .insert(leads)
            .values({
              userId: ctx.userId,
              campaignId,
              url,
              status: "pending",
            })
            .returning();
          inserted.push(lead.id);
        }

        return { campaignId, added: inserted.length, leadIds: inserted };
      },
    },
    {
      key: "scrape_profiles",
      label: "Scrape Lead Profiles",
      isCheckpoint: false,
      async execute(ctx) {
        const { campaignId } = ctx.stepOutputs.create_campaign;

        const campaignLeads = await ctx.db
          .select()
          .from(leads)
          .where(and(eq(leads.campaignId, campaignId), eq(leads.status, "pending")));

        // Profile scraping would call the existing scraping-utils / Apify actor
        // For now we mark leads as "scraped" if they have basic info
        let scraped = 0;
        for (const lead of campaignLeads) {
          await ctx.db
            .update(leads)
            .set({ status: "scraped", updatedAt: new Date() })
            .where(eq(leads.id, lead.id));
          scraped++;
        }

        return {
          campaignId,
          totalLeads: campaignLeads.length,
          scraped,
          note: "Profile scraping placeholder — integrate with Apify/scraping-utils for full data.",
        };
      },
    },
    {
      key: "generate_messages",
      label: "Generate Personalized Messages",
      isCheckpoint: false,
      async execute(ctx) {
        const { campaignId } = ctx.stepOutputs.create_campaign;
        const promptTemplate = ctx.config.customPrompt || "";

        const campaignLeads = await ctx.db
          .select()
          .from(leads)
          .where(eq(leads.campaignId, campaignId));

        let generated = 0;
        for (const lead of campaignLeads) {
          try {
            const response = await generatePersonalizedMessage({
              leadName: lead.name || "there",
              leadTitle: lead.title || "",
              leadCompany: lead.company || "",
              posts: lead.posts || [],
              customPrompt: promptTemplate,
            });

            if (response?.message) {
              await ctx.db.insert(messages).values({
                userId: ctx.userId,
                leadId: lead.id,
                campaignId,
                content: response.message,
                model: "llama-3.1-8b-instant",
                customPrompt: promptTemplate || null,
                status: "draft",
              });
              generated++;
            }
          } catch (err) {
            console.error(`Message gen failed for lead ${lead.id}:`, err.message);
          }
        }

        return { campaignId, totalLeads: campaignLeads.length, generated };
      },
    },
    {
      key: "approve_messages",
      label: "Review & Approve Messages",
      isCheckpoint: true,
      async execute() {},
    },
    {
      key: "send_invites",
      label: "Send LinkedIn Connection Invites",
      isCheckpoint: false,
      async execute(ctx) {
        const { campaignId } = ctx.stepOutputs.create_campaign;

        // This would call the existing LinkedIn invite automation
        // (processInvitesDirectly from libs/linkedin-invite-automation.js)
        // For now we record the intent — real invites need a browser context

        const campaignLeads = await ctx.db
          .select()
          .from(leads)
          .where(and(eq(leads.campaignId, campaignId), eq(leads.inviteSent, false)));

        return {
          campaignId,
          pendingInvites: campaignLeads.length,
          note: "Invite sending queued. Requires active LinkedIn browser session to execute.",
        };
      },
    },
    {
      key: "check_connections",
      label: "Check Connection Acceptance",
      isCheckpoint: false,
      async execute(ctx) {
        const { campaignId } = ctx.stepOutputs.create_campaign;

        const sentLeads = await ctx.db
          .select()
          .from(leads)
          .where(and(eq(leads.campaignId, campaignId), eq(leads.inviteSent, true)));

        const accepted = sentLeads.filter((l) => l.inviteStatus === "accepted").length;
        const pending = sentLeads.filter((l) => l.inviteStatus === "sent").length;

        return {
          campaignId,
          totalSent: sentLeads.length,
          accepted,
          pending,
        };
      },
    },
    {
      key: "report_results",
      label: "Generate Results Report",
      isCheckpoint: false,
      async execute(ctx) {
        const { campaignId } = ctx.stepOutputs.create_campaign;

        const allLeads = await ctx.db
          .select()
          .from(leads)
          .where(eq(leads.campaignId, campaignId));

        const allMessages = await ctx.db
          .select()
          .from(messages)
          .where(eq(messages.campaignId, campaignId));

        return {
          campaignId,
          summary: {
            totalLeads: allLeads.length,
            invitesSent: allLeads.filter((l) => l.inviteSent).length,
            connectionsAccepted: allLeads.filter((l) => l.inviteStatus === "accepted").length,
            messagesGenerated: allMessages.length,
            messagesSent: allMessages.filter((m) => m.status === "sent").length,
          },
        };
      },
    },
  ],
};
