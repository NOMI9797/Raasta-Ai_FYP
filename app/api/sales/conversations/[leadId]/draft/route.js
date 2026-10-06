import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { ownedLead } from "@/libs/sales/conversation/access";
import { draftWithAi } from "@/libs/sales/conversation/drafts";
import { conversationFail } from "@/libs/sales/conversation/http";

// POST /api/sales/conversations/[leadId]/draft — the AI writes an answer to their latest reply, from the knowledge base
export const POST = withAuth(async (request, { user, params }) => {
  try {
    const row = await ownedLead(params.leadId, user);
    if (!row) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    const result = await draftWithAi(row.lead, { senderName: user.name });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return conversationFail(error, "Could not write a reply");
  }
}, { requireUser: true });
