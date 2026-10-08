// Error responses for the conversation and meeting API routes.
import { NextResponse } from "next/server";
import { DraftError } from "./drafts";

export function conversationFail(error, fallback) {
  if (error instanceof DraftError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error?.code === "rate_limit") return NextResponse.json({ error: "The AI is busy (rate limit). Try again in a minute." }, { status: 429 });
  console.error(`${fallback}:`, error?.message);
  return NextResponse.json({ error: `${fallback}: ${error?.message || "unknown error"}` }, { status: 500 });
}
