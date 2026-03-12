import { campaigns, leads, messages, linkedinAccounts, posts } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { generatePersonalizedMessage } from "@/libs/groq-service";
import { testLinkedInSession, cleanupBrowserSession } from "@/libs/linkedin-session-validator";
import { processInvitesDirectly } from "@/libs/linkedin-invite-automation";
import { checkConnectionAcceptances } from "@/libs/linkedin-connection-checker";
import { fetchEligibleLeads } from "@/libs/lead-status-manager";
import { checkDailyLimit, incrementDailyCounter } from "@/libs/rate-limit-manager";

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

        const pendingLeads = campaignLeads.filter((l) => l.status === "pending");
        if (pendingLeads.length === 0) {
          return {
            campaignId,
            totalLeads: campaignLeads.length,
            scraped: 0,
            note: "All leads already scraped or processed.",
          };
        }

        // Call the same scraping endpoint the manual "Run All" flow uses
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
          if (items.length > 0) {
            console.log(
              "🤖 [sales_operator] Sample item structure (agent via /api/scrape):",
              JSON.stringify(items[0], null, 2)
            );
          }

          // Process scraped items and update leads (same as manual flow)
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

              // Update lead basic info + embedded posts JSON (for backwards compatibility)
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

              // Also persist posts into the dedicated posts table so the
              // campaigns UI (Recent Posts panel) and message generator
              // can read them via /api/leads/[id]/posts.
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

                // Replace any existing posts for this lead
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
          // Mark remaining leads as scraped to unblock pipeline
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
          // Skip leads that already have a message
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
            console.log("🤖 [sales_operator] Calling internal /api/messages/generate", {
              endpoint,
              leadId: lead.id,
            });

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

    // ─── Step 4: Send LinkedIn connection invites (real Playwright automation) ───
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

        // Fetch the LinkedIn account from DB
        const [account] = await ctx.db
          .select()
          .from(linkedinAccounts)
          .where(eq(linkedinAccounts.id, accountId))
          .limit(1);

        if (!account) throw new Error("LinkedIn account not found");

        // Override daily limit if the user configured a custom one
        if (dailyInviteLimit && dailyInviteLimit !== account.dailyLimit) {
          await ctx.db
            .update(linkedinAccounts)
            .set({ dailyLimit: dailyInviteLimit })
            .where(eq(linkedinAccounts.id, accountId));
        }

        // Check daily limit
        const limitCheck = await checkDailyLimit(accountId);
        if (!limitCheck.canSend) {
          const result = {
            campaignId,
            sent: 0,
            note: `Daily invite limit reached (${limitCheck.sent}/${limitCheck.limit}). Resets at ${limitCheck.resetsAt.toLocaleString()}.`,
          };
          console.log("🤖 [sales_operator] Step send_invites: completed (limit reached)", result);
          return result;
        }

        // Fetch eligible leads (not yet invited)
        const { eligibleLeads } = await fetchEligibleLeads(campaignId);
        if (!eligibleLeads || eligibleLeads.length === 0) {
          return { campaignId, sent: 0, note: "No eligible leads to invite." };
        }

        // Cap to remaining daily allowance
        const maxToSend = Math.min(
          eligibleLeads.length,
          limitCheck.remaining,
          dailyInviteLimit || limitCheck.limit
        );
        const leadsToProcess = eligibleLeads.slice(0, maxToSend);

        // Validate LinkedIn session & get browser
        const sessionCheck = await testLinkedInSession(account, true);
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

          // Increment daily counter
          if (results.sent > 0) {
            await incrementDailyCounter(accountId, results.sent);
          }
        } finally {
          await cleanupBrowserSession(sessionCheck.context);
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
          waitMinutes: ctx.config?.waitMinutes,
        });
        const { accountId, waitMinutes } = ctx.config;
        // For local testing, keep this short so the pipeline can be validated quickly.
        const waitMs = (waitMinutes ?? 0.25) * 60 * 1000; // default 15 seconds
        const waitSeconds = Math.max(1, Math.round(waitMs / 1000));

        console.log(`⏳ Waiting ${waitSeconds} seconds before checking connection acceptance...`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));

        // Use the exact same endpoint as the manual "Check Connections" button
        const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
        if (!baseUrl) {
          throw new Error("Base URL not configured (NEXTAUTH_URL or NEXT_PUBLIC_APP_URL)");
        }
        const endpoint = new URL("/api/linkedin/connections/check-acceptance", baseUrl).toString();
        const token = process.env.INTERNAL_AGENT_TOKEN;
        if (!token) {
          throw new Error("INTERNAL_AGENT_TOKEN not configured for agent internal calls");
        }

        console.log("🤖 [sales_operator] Calling internal /api/linkedin/connections/check-acceptance", {
          endpoint,
        });

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

    // ─── Step 6: Send messages to accepted connections ───
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

        // checkConnectionAcceptances in step 5 already sends messages to accepted
        // connections that have generated messages. This step reports the final state.

        const campaignLeads = await ctx.db
          .select()
          .from(leads)
          .where(eq(leads.campaignId, campaignId));

        const accepted = campaignLeads.filter((l) => l.inviteStatus === "accepted");
        const messaged = campaignLeads.filter((l) => l.messageSent === true);
        const pendingMsg = accepted.filter((l) => !l.messageSent);

        // If there are still accepted leads without messages sent, try sending
        if (pendingMsg.length > 0) {
          const [account] = await ctx.db
            .select()
            .from(linkedinAccounts)
            .where(eq(linkedinAccounts.id, accountId))
            .limit(1);

          if (account) {
            try {
              const { checkDailyMessageLimit, incrementMessageCounter } = await import(
                "@/libs/rate-limit-manager"
              );
              const { sendMessageToLead, randomDelay } = await import("@/libs/linkedin-message-sender");

              const msgLimitCheck = await checkDailyMessageLimit(accountId);
              if (msgLimitCheck.canSend) {
                const sessionCheck = await testLinkedInSession(account, true);
                if (sessionCheck.isValid) {
                  let sent = 0;
                  try {
                    for (const lead of pendingMsg) {
                      const currentLimit = await checkDailyMessageLimit(accountId);
                      if (!currentLimit.canSend) break;

                      const [msg] = await ctx.db
                        .select()
                        .from(messages)
                        .where(and(eq(messages.leadId, lead.id), eq(messages.campaignId, campaignId)))
                        .limit(1);

                      if (!msg) continue;

                      const result = await sendMessageToLead(
                        sessionCheck.page,
                        lead.url,
                        msg.content,
                        lead.name || "Lead"
                      );

                      if (result.success) {
                        await ctx.db
                          .update(leads)
                          .set({ messageSent: true, messageSentAt: new Date(), messageError: null })
                          .where(eq(leads.id, lead.id));
                        await ctx.db
                          .update(messages)
                          .set({ status: "sent", sentAt: new Date() })
                          .where(eq(messages.id, msg.id));
                        await incrementMessageCounter(accountId);
                        sent++;

                        if (sent < pendingMsg.length) {
                          await randomDelay(30, 90);
                        }
                      }
                    }
                  } finally {
                    await cleanupBrowserSession(sessionCheck.context);
                  }
                }
              }
            } catch (err) {
              console.error("Additional message sending error:", err.message);
            }
          }
        }

        // Refresh state
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
