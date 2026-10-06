// Error responses for the knowledge base API routes.
import { NextResponse } from "next/server";
import { KnowledgeError } from "./store";

export function knowledgeFail(error, fallback) {
  if (error instanceof KnowledgeError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(`${fallback}:`, error?.message);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
