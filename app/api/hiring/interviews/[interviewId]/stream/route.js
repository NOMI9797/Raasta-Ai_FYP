import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { findOwnedInterview } from "@/libs/hiring/interview-views";
import { subscribeToInterview } from "@/libs/interview/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_MS = 15 * 1000;

// GET /api/hiring/interviews/[interviewId]/stream — live view (server-sent events). Read-only:
// forwards what the interview engine publishes (questions, captions, answer scores, integrity
// events, status changes) on Redis channel interview:{id}.
export const GET = withAuth(async (request, { params, user }) => {
  const interview = await findOwnedInterview(params.interviewId, user);
  if (!interview) return NextResponse.json({ error: "Interview not found" }, { status: 404 });

  const encoder = new TextEncoder();
  let closed = false;
  let stop = null;
  let heartbeat = null;
  let controllerRef = null;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    if (stop) stop().catch(() => {});
    try {
      controllerRef?.close();
    } catch {
      // already closed
    }
  };

  const stream = new ReadableStream({
    async start(controller) {
      controllerRef = controller;
      const write = (text) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      };
      const send = (data) => write(`data: ${JSON.stringify(data)}\n\n`);

      request.signal.addEventListener("abort", cleanup);
      send({ type: "connected", interviewId: interview.id, status: interview.status });
      heartbeat = setInterval(() => write(": heartbeat\n\n"), HEARTBEAT_MS);

      try {
        const unsubscribe = await subscribeToInterview(interview.id, send);
        if (closed) await unsubscribe(); // the viewer left while we were subscribing
        else stop = unsubscribe;
      } catch {
        send({ type: "error", message: "Live updates are unavailable right now" });
        cleanup();
      }
    },
    cancel: cleanup,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}, { requireUser: true });
