import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { discardDraft, editDraft } from "@/libs/sales/conversation/drafts";
import { conversationFail } from "@/libs/sales/conversation/http";

// PATCH /api/sales/conversations/drafts/[id] { subject?, body?, toAddress? } — edit a reply or follow-up before it goes
export const PATCH = withAuth(async (request, { user, params }) => {
  try {
    const body = await request.json();
    const draft = await editDraft(params.id, user, { subject: body.subject, body: body.body, toAddress: body.toAddress });
    return NextResponse.json({ success: true, draft });
  } catch (error) {
    return conversationFail(error, "Could not save the draft");
  }
}, { requireUser: true });

// DELETE /api/sales/conversations/drafts/[id] — don't send it (the agent's request is withdrawn too)
export const DELETE = withAuth(async (request, { user, params }) => {
  try {
    await discardDraft(params.id, user);
    return NextResponse.json({ success: true });
  } catch (error) {
    return conversationFail(error, "Could not discard the draft");
  }
}, { requireUser: true });
