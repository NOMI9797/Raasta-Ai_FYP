import { NextResponse } from "next/server";
import { AccessError } from "@/libs/interview/public-access";

// Public candidate routes: no caching, no indexing
const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

export function ok(body, status = 200) {
  return NextResponse.json({ success: true, ...body }, { status, headers: HEADERS });
}

export function fail(code, message, status, extraHeaders = {}) {
  return NextResponse.json({ error: message, code }, { status, headers: { ...HEADERS, ...extraHeaders } });
}

/** Map an error to a response. Never include the token. */
export function handleError(error, label) {
  if (error instanceof AccessError) {
    const headers = error.retryAfterSec ? { "Retry-After": String(error.retryAfterSec) } : {};
    return fail(error.code, error.message, error.status, headers);
  }
  console.error(`${label} error:`, error?.message);
  return fail("internal", "Something went wrong. Please try again.", 500);
}
