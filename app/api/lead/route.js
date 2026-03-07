import { NextResponse } from "next/server";

// This route is used to store the leads that are generated from the landing page.
// The API call is initiated by <ButtonLead /> component
// Duplicate emails just return 200 OK
export async function POST(req) {
  const body = await req.json();

  if (!body.email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  // Persisting leads via Mongo was removed. If you need storage, wire this to your current DB.
  // For now, accept the email and return success to avoid unused dependencies.
  return NextResponse.json({});
}
