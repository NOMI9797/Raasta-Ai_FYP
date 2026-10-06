import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/libs/db";
import { withAuth } from "@/libs/auth-middleware";
import { leads, meetings } from "@/libs/schema";
import { MEETING_STATUS, meetingInvite, updateMeeting } from "@/libs/sales/meetings/store";
import { getSalesSettings } from "@/libs/sales/meetings/settings";
import { loadThread, recordOutbound, replySubject, threadReferences } from "@/libs/sales/conversation/thread";
import { replyAddress } from "@/libs/sales/conversation/decide";
import { sendSalesEmail, testRecipient } from "@/libs/sales/send/email";
import { CONVERSATION_STATUS } from "@/libs/sales/conversation/status";

// PATCH /api/sales/meetings/[id] { status?, notes?, outcome?, message? }
// status "cancelled" with a `message` emails the client in the thread, with a calendar cancellation.
export const PATCH = withAuth(async (request, { user, params }) => {
  try {
    const conditions = [eq(meetings.id, params.id)];
    if (user.role !== "admin") conditions.push(eq(meetings.userId, user.id));
    const [meeting] = await db.select().from(meetings).where(and(...conditions)).limit(1);
    if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
    const body = await request.json();

    const updated = await updateMeeting(meeting, { status: body.status, notes: body.notes, outcome: body.outcome });
    let emailed = null;
    if (body.status === MEETING_STATUS.CANCELLED) {
      const [lead] = await db.select().from(leads).where(eq(leads.id, meeting.leadId)).limit(1);
      if (String(body.message || "").trim() && meeting.status === MEETING_STATUS.CONFIRMED) {
        const thread = await loadThread(lead.id);
        const settings = await getSalesSettings(meeting.userId);
        const to = replyAddress(thread, { testRecipient: testRecipient() }) || meeting.attendeeEmail;
        const calendar = meetingInvite(updated, { organizer: { name: settings.companyName || user.name, email: process.env.SENDER_EMAIL }, method: "CANCEL" });
        const subject = replySubject(thread);
        const lastId = [...thread].reverse().find((m) => m.emailMessageId)?.emailMessageId || null;
        const sent = await sendSalesEmail({ to, subject, body: String(body.message).slice(0, 5000), senderName: user.name, inReplyTo: lastId, references: threadReferences(thread), calendar });
        await recordOutbound({ lead, kind: "reply", subject, body: String(body.message), toAddress: to, sent, inReplyTo: lastId, references: threadReferences(thread) });
        emailed = { to: sent.to, redirected: sent.redirected };
      }
      // Back to an open conversation, so a new time can be agreed
      if (lead?.conversationStatus === CONVERSATION_STATUS.MEETING_BOOKED) {
        await db.update(leads).set({ conversationStatus: CONVERSATION_STATUS.IN_CONVERSATION, updatedAt: new Date() }).where(eq(leads.id, lead.id));
      }
    }
    return NextResponse.json({ success: true, meeting: updated, emailed });
  } catch (error) {
    console.error("Update meeting error:", error?.message);
    return NextResponse.json({ error: error?.message || "Could not update the meeting" }, { status: 500 });
  }
}, { requireUser: true });
