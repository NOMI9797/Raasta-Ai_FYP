import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { getInterviewDetail } from "@/libs/hiring/interview-views";

// GET /api/hiring/interviews/[interviewId] — interview, job, candidate, scored answers, transcript
// and recording links that expire after 15 minutes.
export const GET = withAuth(async (request, { params, user }) => {
  try {
    const detail = await getInterviewDetail(params.interviewId, user);
    if (!detail) return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    return NextResponse.json({ success: true, ...detail });
  } catch (error) {
    console.error("Get interview error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
