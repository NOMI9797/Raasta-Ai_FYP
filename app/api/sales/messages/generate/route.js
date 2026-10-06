import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/libs/db";
import { withAuth } from "@/libs/auth-middleware";
import { campaigns, leads, messages, posts, users } from "@/libs/schema";
import { getModel } from "@/libs/ai/llm";
import { PLATFORM_KIND } from "@/libs/sales/stages";
import { companyNameOf, jobsOf } from "@/libs/sales/companies";
import { CHANNELS, companyPrompt, defaultChannel, personPrompt, pickRecipient, writeMessage } from "@/libs/sales/message-writer";

export const maxDuration = 60;

// POST /api/sales/messages/generate { leadId, channel? } — write (or rewrite) the lead's message.
// A draft or approved message is replaced and goes back to draft; a sent one is never touched.
export const POST = withAuth(async (request, { user }) => {
  try {
    const { leadId, channel: requestedChannel } = await request.json();
    const [lead] = await db.select().from(leads).where(and(eq(leads.id, leadId || ""), eq(leads.userId, user.id))).limit(1);
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, lead.campaignId)).limit(1);
    const [sender] = await db.select({ name: users.name }).from(users).where(eq(users.id, user.id)).limit(1);
    const senderName = sender?.name || user.name || null;
    const isCompany = PLATFORM_KIND[lead.source] === "company";

    let channel = "linkedin";
    let recipient = null;
    let prompt;
    if (isCompany) {
      const research = lead.sourceData?.research || null;
      channel = CHANNELS[requestedChannel] ? requestedChannel : defaultChannel(research);
      recipient = pickRecipient(research, channel);
      prompt = companyPrompt({ company: companyNameOf(lead), jobs: jobsOf(lead), research, campaign, channel, recipient, senderName });
    } else {
      if (lead.status !== "completed") {
        return NextResponse.json({ error: "Read this person's profile first (Research step)." }, { status: 400 });
      }
      const recent = await db.select().from(posts).where(eq(posts.leadId, lead.id)).orderBy(desc(posts.engagement)).limit(5);
      recipient = { address: lead.url, name: lead.name, title: lead.title };
      prompt = personPrompt({ lead, posts: recent, campaign, senderName });
    }

    const written = await writeMessage({ ...prompt, channel });
    const values = {
      content: written.body,
      subject: written.subject,
      channel,
      recipient: recipient?.address || null,
      model: getModel().slice(0, 50),
      source: lead.source,
      status: "draft",
      approvedAt: null,
      updatedAt: new Date(),
    };

    const [existing] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.leadId, lead.id), eq(messages.userId, user.id), inArray(messages.status, ["draft", "approved"])))
      .orderBy(desc(messages.updatedAt))
      .limit(1);

    const [message] = existing
      ? await db.update(messages).set(values).where(eq(messages.id, existing.id)).returning()
      : await db.insert(messages).values({ ...values, userId: user.id, leadId: lead.id, campaignId: lead.campaignId }).returning();

    return NextResponse.json({ success: true, message, recipientName: recipient?.name || null });
  } catch (error) {
    console.error("Generate sales message error:", error);
    const status = error?.code === "rate_limit" ? 429 : 500;
    return NextResponse.json({ error: error?.code === "rate_limit" ? "The AI is busy. Try again in a minute." : error.message || "Could not write the message" }, { status });
  }
}, { requireUser: true });
