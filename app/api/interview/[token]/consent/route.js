import { eq } from "drizzle-orm";
import { db } from "@/libs/db";
import { interviews } from "@/libs/schema";
import { markOpened, resolveInterviewToken } from "@/libs/interview/public-access";
import { ok, fail, handleError } from "../../_lib/respond";

// POST /api/interview/[token]/consent — body { accepted: true } → consent_at
export async function POST(request, { params }) {
  try {
    const ctx = await resolveInterviewToken(params.token, { route: "consent" });
    const body = await request.json().catch(() => ({}));
    if (body?.accepted !== true) {
      return fail("consent_required", "Please accept the recording and AI evaluation terms to continue.", 400);
    }
    const interview = await markOpened(ctx.interview);
    if (!interview.consentAt) {
      await db.update(interviews).set({ consentAt: new Date(), updatedAt: new Date() }).where(eq(interviews.id, interview.id));
    }
    return ok({ consentGiven: true });
  } catch (error) {
    return handleError(error, "Interview consent");
  }
}
