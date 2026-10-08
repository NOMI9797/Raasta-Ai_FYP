import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { inboxStatus, syncSalesInbox } from "@/libs/sales/inbox/sync";

// POST /api/sales/conversations/sync — check the mailbox for replies now (the worker also does it every 2 minutes)
export const POST = withAuth(async () => {
  try {
    const result = await syncSalesInbox();
    return NextResponse.json({ success: true, ...result, inbox: await inboxStatus() });
  } catch (error) {
    console.error("Inbox sync error:", error?.message);
    const auth = /auth|credentials|login/i.test(error?.message || "");
    return NextResponse.json({ error: auth ? "The mailbox refused the login: check SENDER_EMAIL / SENDER_PASSWORD and that IMAP is enabled" : `Could not read the mailbox: ${error?.message}` }, { status: 502 });
  }
}, { requireUser: true });
