import { leads, messages, posts } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { processInvitesDirectly } from "@/libs/linkedin-invite-automation";
import { fetchEligibleLeads } from "@/libs/lead-status-manager";
import { getAdapter } from "@/libs/platforms";
import { randomDelay } from "@/libs/linkedin-message-sender";

export const salesOperatorPipeline = {
  steps: [
    // ─── Step 1: Scrape lead profiles via Apify ───
    {
      key: "scrape_profiles",
      label: "Scrape Lead Profiles",
      isCheckpoint: false,
      async execute(ctx) {
        console.log("🤖 [sales_operator] Step scrape_profiles: started", {
          campaignId: ctx.config?.campaignId,
        });
        const { campaignId } = ctx.config;
        if (!campaignId) throw new Error("No campaignId in agent config");

        const campaignLeads = await ctx.db
          .select()
          .from(leads)
          .where(eq(leads.campaignId, campaignId));

        if (campaignLeads.length === 0) {
          return { campaignId, scraped: 0, note: "No leads in this campaign. Add leads first." };
        }

        const pendingLeads = campaignLeads.filter(
          (l) => l.status === "pending" && (l.source || "linkedin") === "linkedin"
        );
        if (pendingLeads.length === 0) {
          return {
            campaignId,
            totalLeads: campaignLeads.length,
            scraped: 0,
            note: "All leads already scraped or processed.",
          };
        }

        const leadUrls = pendingLeads.map((l) => l.url);
        let scrapedCount = 0;

        try {
          const baseUrl =
            process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
          if (!baseUrl) {
            throw new Error(
              "Base URL not configured (NEXTAUTH_URL or NEXT_PUBLIC_APP_URL)"
            );
          }

          const endpoint = new URL("/api/scrape", baseUrl).toString();
          console.log("🤖 [sales_operator] Calling internal /api/scrape", {
            endpoint,
            leadCount: leadUrls.length,
          });

          const resp = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              urls: leadUrls,
              limitPerSource: 2,
              deepScrape: true,
              rawData: false,
              streamProgress: false,
            }),
          });

          const data = await resp.json();
          if (!resp.ok) {
            throw new Error(data.error || "Failed to scrape profiles via /api/scrape");
          }

          const items = data.items || [];
          console.log(
            "🤖 [sales_operator] /api/scrape items (agent scrape_profiles):",
            items.length
          );

          const { extractLeadInfo, cleanScrapedPosts } = await import(
            "@/libs/scraping-utils"
          );

          for (const lead of pendingLeads) {
            const leadItems = items.filter(
              (item) =>
                (item.inputUrl || item.sourceUrl || "")
                  .toLowerCase()
                  .includes(
                    lead.url.toLowerCase().replace(/\/$/, "").split("/").pop()
                  )
            );

            if (leadItems.length > 0) {
              const info = extractLeadInfo(leadItems);
              const cleanedPosts = cleanScrapedPosts(leadItems);

              await ctx.db
                .update(leads)
                .set({
                  name: info.name || lead.name,
                  title: info.title || lead.title,
                  company: info.company || lead.company,
                  profilePicture: info.profilePicture || lead.profilePicture,
                  posts: cleanedPosts,
                  status: "completed",
                  updatedAt: new Date(),
                })
                .where(eq(leads.id, lead.id));

              if (Array.isArray(cleanedPosts) && cleanedPosts.length > 0) {
                const rows = cleanedPosts.map((p) => {
                  const likes = Number(p.numLikes || 0) || 0;
                  const comments = Number(p.numComments || 0) || 0;
                  const shares = Number(p.numShares || 0) || 0;
                  return {
                    userId: ctx.userId,
                    leadId: lead.id,
                    content: p.content || "",
                    timestamp: new Date(p.timestamp || new Date()),
                    likes,
                    comments,
                    shares,
                    engagement: likes + comments * 2 + shares * 3,
                  };
                });

                await ctx.db
                  .delete(posts)
                  .where(and(eq(posts.leadId, lead.id), eq(posts.userId, ctx.userId)));

                await ctx.db.insert(posts).values(rows);
              }

              scrapedCount++;
            }
          }
        } catch (err) {
          console.error(
            "Agent scrape_profiles via internal /api/scrape error:",
            err.message
          );
          for (const lead of pendingLeads) {
            if (lead.status === "pending") {
              await ctx.db
                .update(leads)
                .set({ status: "error", updatedAt: new Date() })
                .where(eq(leads.id, lead.id));
            }
          }
        }

        const result = { campaignId, totalLeads: campaignLeads.length, scraped: scrapedCount };
        console.log("🤖 [sales_operator] Step scrape_profiles: completed", result);
        return result;
      },
    },

    // ─── Step 2: Generate personalized messages via Groq ───
    {
      key: "generate_messages",
      label: "Generate Personalized Messages",
      isCheckpoint: false,
      async execute(ctx) {
        console.log("🤖 [sales_operator] Step generate_messages: started", {
          campaignId: ctx.config?.campaignId,
        });
        const { campaignId } = ctx.config;
        const promptTemplate = ctx.config.customPrompt || "";

        const campaignLeads = await ctx.db
          .select()
          .from(leads)
          .where(eq(leads.campaignId, campaignId));

        let generated = 0;
        for (const lead of campaignLeads) {
          const existing = await ctx.db
            .select()
            .from(messages)
            .where(and(eq(messages.leadId, lead.id), eq(messages.campaignId, campaignId)))
            .limit(1);

          if (existing.length > 0) continue;

          try {
            const baseUrl =
              process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
            if (!baseUrl) {
              throw new Error(
                "Base URL not configured (NEXTAUTH_URL or NEXT_PUBLIC_APP_URL)"
              );
            }

            const endpoint = new URL("/api/messages/generate", baseUrl).toString();
            const resp = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                leadId: lead.id,
                model: "llama-3.1-8b-instant",
                customPrompt: promptTemplate || "",
              }),
            });

            const data = await resp.json();
            if (!resp.ok || !data.success) {
              throw new Error(data.error || "Failed to generate message via /api/messages/generate");
            }

            generated++;
          } catch (err) {
            console.error(`Message gen failed for lead ${lead.id}:`, err.message);
          }
        }

        const result = { campaignId, totalLeads: campaignLeads.length, generated };
        console.log("🤖 [sales_operator] Step generate_messages: completed", result);
        return result;
      },
    },

    // ─── Step 3: Checkpoint — human reviews messages before sending ───
    {
      key: "approve_messages",
      label: "Review & Approve Messages",
      isCheckpoint: true,
      async execute() {},
    },

    // ─── Step 4: Send LinkedIn connection invites (via adapter) ───
    {
      key: "send_invites",
      label: "Send LinkedIn Invites",
      isCheckpoint: false,
      async execute(ctx) {
        console.log("🤖 [sales_operator] Step send_invites: started", {
          campaignId: ctx.config?.campaignId,
          accountId: ctx.config?.accountId,
        });
        const { campaignId, accountId, dailyInviteLimit } = ctx.config;
        if (!accountId) throw new Error("No LinkedIn accountId in agent config");

        const adapter = getAdapter("linkedin");
        const account = await adapter.getAccount(accountId);
        if (!account) throw new Error("LinkedIn account not found");

        if (dailyInviteLimit && dailyInviteLimit !== account.dailyLimit) {
          await ctx.db
            .update(adapter.accountsTable)
            .set({ dailyLimit: dailyInviteLimit })
            .where(eq(adapter.accountsTable.id, accountId));
        }

        const limitCheck = await adapter.rateLimit.checkInvites(accountId);
        if (!limitCheck.canSend) {
          const result = {
            campaignId,
            sent: 0,
            note: `Daily invite limit reached (${limitCheck.sent}/${limitCheck.limit}). Resets at ${limitCheck.resetsAt.toLocaleString()}.`,
          };
          console.log("🤖 [sales_operator] Step send_invites: completed (limit reached)", result);
          return result;
        }

        const { eligibleLeads } = await fetchEligibleLeads(campaignId, { sourceFilter: "linkedin" });
        if (!eligibleLeads || eligibleLeads.length === 0) {
          return { campaignId, sent: 0, note: "No eligible leads to invite." };
        }

        const maxToSend = Math.min(
          eligibleLeads.length,
          limitCheck.remaining,
          dailyInviteLimit || limitCheck.limit
        );
        const leadsToProcess = eligibleLeads.slice(0, maxToSend);

        const sessionCheck = await adapter.testSession(account, true);
        if (!sessionCheck.isValid) {
          throw new Error(`LinkedIn session invalid: ${sessionCheck.reason}`);
        }

        let results;
        try {
          results = await processInvitesDirectly(
            sessionCheck.context,
            sessionCheck.page,
            leadsToProcess,
            "",
            campaignId
          );

          if (results.sent > 0) {
            await adapter.rateLimit.incrementInvites(accountId, results.sent);
          }
        } finally {
          await adapter.cleanupSession(sessionCheck.context);
        }

        const result = {
          campaignId,
          sent: results.sent,
          alreadyConnected: results.alreadyConnected,
          alreadyPending: results.alreadyPending,
          failed: results.failed,
          total: leadsToProcess.length,
        };
        console.log("🤖 [sales_operator] Step send_invites: completed", result);
        return result;
      },
    },

    // ─── Step 5: Wait, then check which invites were accepted ───
    {
      key: "wait_and_check",
      label: "Wait & Check Connections",
      isCheckpoint: false,
      async execute(ctx) {
        console.log("🤖 [sales_operator] Step wait_and_check: started", {
          accountId: ctx.config?.accountId,
          waitSeconds: ctx.config?.waitSeconds,
        });
        const waitSeconds = Math.max(1, Number(ctx.config?.waitSeconds ?? 180));
        const waitMs = waitSeconds * 1000;

        console.log(`⏳ Waiting ${waitSeconds} seconds before checking connection acceptance...`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));

        const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
        if (!baseUrl) {
          throw new Error("Base URL not configured (NEXTAUTH_URL or NEXT_PUBLIC_APP_URL)");
        }
        const endpoint = new URL("/api/linkedin/connections/check-acceptance", baseUrl).toString();
        const token = process.env.INTERNAL_AGENT_TOKEN;
        if (!token) {
          throw new Error("INTERNAL_AGENT_TOKEN not configured for agent internal calls");
        }

        const resp = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-agent-token": token,
          },
          body: JSON.stringify({ userId: ctx.userId }),
        });

        const result = await resp.json();
        if (!resp.ok || !result.success) {
          throw new Error(result.error || "Connection acceptance check failed");
        }

        const summary = {
          matched: result.matched || 0,
          updated: result.updated || 0,
          messagesSent: result.messagesSent || 0,
          total: result.total || 0,
        };
        console.log("🤖 [sales_operator] Step wait_and_check: completed", summary);
        return summary;
      },
    },

    // ─── Step 6: Send LinkedIn messages to accepted connections (via adapter) ───
    {
      key: "send_messages",
      label: "Send Messages to Accepted",
      isCheckpoint: false,
      async execute(ctx) {
        console.log("🤖 [sales_operator] Step send_messages: started", {
          campaignId: ctx.config?.campaignId,
          accountId: ctx.config?.accountId,
        });
        const { campaignId, accountId } = ctx.config;

        const campaignLeads = await ctx.db
          .select()
          .from(leads)
          .where(eq(leads.campaignId, campaignId));

        const linkedInLeads = campaignLeads.filter((l) => (l.source || "linkedin") === "linkedin");
        const accepted = linkedInLeads.filter((l) => l.inviteStatus === "accepted");
        const pendingMsg = accepted.filter((l) => !l.messageSent);

        if (pendingMsg.length > 0 && accountId) {
          const adapter = getAdapter("linkedin");
          const account = await adapter.getAccount(accountId);

          if (account) {
            try {
              const msgLimitCheck = await adapter.rateLimit.checkMessages(accountId);
              if (msgLimitCheck.canSend) {
                const sessionCheck = await adapter.testSession(account, true);
                if (sessionCheck.isValid) {
                  let sent = 0;
                  try {
                    for (const lead of pendingMsg) {
                      const currentLimit = await adapter.rateLimit.checkMessages(accountId);
                      if (!currentLimit.canSend) break;

                      const [msg] = await ctx.db
                        .select()
                        .from(messages)
                        .where(and(eq(messages.leadId, lead.id), eq(messages.campaignId, campaignId)))
                        .limit(1);

                      if (!msg) continue;

                      const result = await adapter.sendMessageWithPage(sessionCheck.page, {
                        leadUrl: lead.url,
                        message: msg.content,
                        leadName: lead.name || "Lead",
                      });

                      if (result.success) {
                        await ctx.db
                          .update(leads)
                          .set({ messageSent: true, messageSentAt: new Date(), messageError: null })
                          .where(eq(leads.id, lead.id));
                        await ctx.db
                          .update(messages)
                          .set({ status: "sent", sentAt: new Date() })
                          .where(eq(messages.id, msg.id));
                        await adapter.rateLimit.incrementMessages(accountId);
                        sent++;

                        if (sent < pendingMsg.length) {
                          await randomDelay(30, 90);
                        }
                      }
                    }
                  } finally {
                    await adapter.cleanupSession(sessionCheck.context);
                  }
                }
              }
            } catch (err) {
              console.error("Additional message sending error:", err.message);
            }
          }
        }

        const finalLeads = await ctx.db
          .select()
          .from(leads)
          .where(eq(leads.campaignId, campaignId));
        const result = {
          campaignId,
          totalLeads: finalLeads.length,
          invitesSent: finalLeads.filter((l) => l.inviteSent).length,
          accepted: finalLeads.filter((l) => l.inviteStatus === "accepted").length,
          messagesSent: finalLeads.filter((l) => l.messageSent).length,
          pending: finalLeads.filter((l) => l.inviteStatus === "sent").length,
        };
        console.log("🤖 [sales_operator] Step send_messages: completed", result);
        return result;
      },
    },

    // ─── Step 6b: Send Rozee.pk messages to Rozee leads (via adapter) ───
    {
      key: "send_rozee_messages",
      label: "Send Rozee.pk Messages",
      isCheckpoint: false,
      async execute(ctx) {
        const { campaignId, rozeeAccountId } = ctx.config;
        if (!rozeeAccountId) {
          return { campaignId, sent: 0, skipped: true, note: "No Rozee account configured" };
        }

        const adapter = getAdapter("rozee");
        const account = await adapter.getAccount(rozeeAccountId);
        if (!account) throw new Error("Rozee account not found");

        const limitCheck = await adapter.rateLimit.checkMessages(rozeeAccountId);
        if (!limitCheck.canSend) {
          return {
            campaignId,
            sent: 0,
            note: `Rozee daily message limit reached (${limitCheck.sent}/${limitCheck.limit}).`,
          };
        }

        const { eligibleLeads: rozeeLeads } = await fetchEligibleLeads(campaignId, {
          sourceFilter: "rozee",
        });

        const pendingMsgLeads = (rozeeLeads || []).filter((l) => !l.messageSent);
        if (pendingMsgLeads.length === 0) {
          return { campaignId, sent: 0, note: "No pending Rozee leads to message." };
        }

        let sent = 0;
        for (const lead of pendingMsgLeads) {
          const currentLimit = await adapter.rateLimit.checkMessages(rozeeAccountId);
          if (!currentLimit.canSend) break;

          const [msg] = await ctx.db
            .select()
            .from(messages)
            .where(and(eq(messages.leadId, lead.id), eq(messages.campaignId, campaignId)))
            .limit(1);
          if (!msg) continue;

          const result = await adapter.sendMessage(account, {
            leadUrl: lead.url,
            message: msg.content,
            leadName: lead.name || "Candidate",
          });

          if (result?.success) {
            await ctx.db
              .update(leads)
              .set({ messageSent: true, messageSentAt: new Date(), messageError: null })
              .where(eq(leads.id, lead.id));
            await ctx.db
              .update(messages)
              .set({ status: "sent", sentAt: new Date() })
              .where(eq(messages.id, msg.id));
            await adapter.rateLimit.incrementMessages(rozeeAccountId);
            sent += 1;
          } else if (result?.error) {
            await ctx.db
              .update(leads)
              .set({ messageError: result.error })
              .where(eq(leads.id, lead.id));
          }
        }

        return { campaignId, sent, total: pendingMsgLeads.length };
      },
    },

    // ─── Step 7: Final report ───
    {
      key: "report_results",
      label: "Results Report",
      isCheckpoint: false,
      async execute(ctx) {
        console.log("🤖 [sales_operator] Step report_results: started", {
          campaignId: ctx.config?.campaignId,
        });
        const { campaignId } = ctx.config;

        const allLeads = await ctx.db.select().from(leads).where(eq(leads.campaignId, campaignId));
        const allMessages = await ctx.db
          .select()
          .from(messages)
          .where(eq(messages.campaignId, campaignId));
        const summary = {
          campaignId,
          summary: {
            totalLeads: allLeads.length,
            profilesScraped: allLeads.filter((l) => l.status !== "pending").length,
            invitesSent: allLeads.filter((l) => l.inviteSent).length,
            connectionsAccepted: allLeads.filter((l) => l.inviteStatus === "accepted").length,
            connectionsPending: allLeads.filter((l) => l.inviteStatus === "sent").length,
            messagesGenerated: allMessages.length,
            messagesSent: allMessages.filter((m) => m.status === "sent").length,
          },
        };
        console.log("🤖 [sales_operator] Step report_results: completed", summary);
        return summary;
      },
    },
  ],
};
