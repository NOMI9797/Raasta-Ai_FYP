import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { ownedLead } from "@/libs/sales/conversation/access";
import { sendOwnReply } from "@/libs/sales/conversation/drafts";
import { conversationFail } from "@/libs/sales/conversation/http";

// POST /api/sales/conversations/[leadId]/send { body, subject? } — send your own message in the thread
export const POST = withAuth(async (request, { user, params }) => {
  try {
    const row = await ownedLead(params.leadId, user);
    if (!row) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    const { body, subject } = await request.json();
    const result = await sendOwnReply(row.lead, { body, subject }, { senderName: user.name });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return conversationFail(error, "Could not send");
  }
}, { requireUser: true });
