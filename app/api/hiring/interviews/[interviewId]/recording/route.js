import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { ViewError, deleteInterviewRecording } from "@/libs/hiring/interview-views";

// DELETE /api/hiring/interviews/[interviewId]/recording — privacy: remove the audio and video.
// Scores, transcript and analysis are kept; the interview can't be re-analysed afterwards.
export const DELETE = withAuth(async (request, { params, user }) => {
  try {
    const result = await deleteInterviewRecording(params.interviewId, user);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof ViewError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("Delete recording error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
