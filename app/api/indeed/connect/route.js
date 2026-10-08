import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { ConnectError, cancelIndeedConnect, getConnectStatus, startIndeedConnect } from "@/libs/indeed-connect";

// Connecting Indeed means signing in yourself in a real browser window (libs/indeed-connect.js).
//   POST   { email }  opens the window and returns at once
//   GET               the state of this person's sign-in: idle | waiting | connected | failed | cancelled
//   DELETE            closes the window and stops waiting

export const POST = withAuth(async (request, { user }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const attempt = startIndeedConnect({ userId: user.id, email: body.email });
    return NextResponse.json({ success: true, attempt }, { status: 202 });
  } catch (error) {
    if (error instanceof ConnectError) {
      const status = error.code === "in_progress" ? 409 : error.code === "no_display" ? 501 : 400;
      return NextResponse.json({ error: error.code, message: error.message }, { status });
    }
    console.error("Indeed connect error:", error.message);
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Could not open the Indeed sign-in window" }, { status: 500 });
  }
}, { requireUser: true });

export const GET = withAuth(async (request, { user }) => {
  return NextResponse.json({ success: true, attempt: getConnectStatus(user.id) });
}, { requireUser: true });

export const DELETE = withAuth(async (request, { user }) => {
  return NextResponse.json({ success: true, attempt: await cancelIndeedConnect(user.id) });
}, { requireUser: true });
