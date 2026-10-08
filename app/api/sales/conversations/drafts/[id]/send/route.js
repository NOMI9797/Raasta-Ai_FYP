import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { sendDraftNow } from "@/libs/sales/conversation/drafts";
import { conversationFail } from "@/libs/sales/conversation/http";

// POST /api/sales/conversations/drafts/[id]/send — send it now (the agent sends drafts it is waiting on)
export const POST = withAuth(async (request, { user, params }) => {
  try {
    const result = await sendDraftNow(params.id, user, { senderName: user.name });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return conversationFail(error, "Could not send");
  }
}, { requireUser: true });
