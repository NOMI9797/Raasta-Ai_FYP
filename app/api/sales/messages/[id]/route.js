import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/libs/db";
import { withAuth } from "@/libs/auth-middleware";
import { messages } from "@/libs/schema";
import { CHANNELS } from "@/libs/sales/message-writer";

const text = (v, max) => (typeof v === "string" ? v.slice(0, max) : undefined);

// PATCH /api/sales/messages/[id] { content?, subject?, recipient?, channel?, status?: "draft" | "approved" }
// Edits move an approved message back to draft unless the same request approves it. Sent messages are locked.
export const PATCH = withAuth(async (request, { user, params }) => {
  try {
    const body = await request.json();
    const [message] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.id, params.id), eq(messages.userId, user.id)))
      .limit(1);
    if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 });
    if (message.status === "sent") return NextResponse.json({ error: "This message was already sent" }, { status: 409 });

    const changes = {};
    const content = text(body.content, 5000);
    if (content !== undefined) {
      if (!content.trim()) return NextResponse.json({ error: "The message is empty" }, { status: 400 });
      changes.content = content;
    }
    if (body.subject !== undefined) changes.subject = text(body.subject, 200) || null;
    if (body.recipient !== undefined) changes.recipient = text(body.recipient, 300)?.trim() || null;
    if (body.channel !== undefined) {
      if (!CHANNELS[body.channel]) return NextResponse.json({ error: "Unknown channel" }, { status: 400 });
      changes.channel = body.channel;
    }

    const edited = Object.keys(changes).length > 0;
    if (body.status === "approved") {
      changes.status = "approved";
      changes.approvedAt = new Date();
    } else if (body.status === "draft" || edited) {
      changes.status = "draft";
      changes.approvedAt = null;
    }

    const [updated] = await db
      .update(messages)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(messages.id, message.id))
      .returning();
    return NextResponse.json({ success: true, message: updated });
  } catch (error) {
    console.error("Update sales message error:", error);
    return NextResponse.json({ error: "Could not save the message" }, { status: 500 });
  }
}, { requireUser: true });
