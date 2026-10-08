import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { ownedLead } from "@/libs/sales/conversation/access";
import { loadThread } from "@/libs/sales/conversation/thread";
import { setConversationStatus } from "@/libs/sales/conversation/drafts";
import { conversationFail } from "@/libs/sales/conversation/http";
import { listMeetingsForLead } from "@/libs/sales/meetings/store";

// GET /api/sales/conversations/[leadId] — the lead and its whole email thread
export const GET = withAuth(async (request, { user, params }) => {
  try {
    const row = await ownedLead(params.leadId, user);
    if (!row) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    const [thread, meetings] = await Promise.all([loadThread(row.lead.id), listMeetingsForLead(row.lead.id)]);
    const { lead } = row;
    return NextResponse.json({
      success: true,
      lead: {
        id: lead.id, name: lead.name, company: lead.company || lead.sourceData?.company?.name || null, title: lead.title,
        source: lead.source, url: lead.url, campaignId: lead.campaignId, campaignName: row.campaignName,
        status: lead.conversationStatus, nextFollowUpAt: lead.nextFollowUpAt, followUpsSent: lead.followUpsSent,
        fit: lead.sourceData?.fit || null, website: lead.sourceData?.research?.website || null,
      },
      thread,
      meetings,
    });
  } catch (error) {
    console.error("Conversation error:", error);
    return NextResponse.json({ error: "Could not load the conversation" }, { status: 500 });
  }
}, { requireUser: true });

// PATCH /api/sales/conversations/[leadId] { status } — move the conversation on by hand (close it, or re-open it)
export const PATCH = withAuth(async (request, { user, params }) => {
  try {
    const row = await ownedLead(params.leadId, user);
    if (!row) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    const { status } = await request.json();
    await setConversationStatus(row.lead, status);
    return NextResponse.json({ success: true, status });
  } catch (error) {
    return conversationFail(error, "Could not update the conversation");
  }
}, { requireUser: true });
