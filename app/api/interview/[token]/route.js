import { markOpened, publicInterviewView, resolveInterviewToken } from "@/libs/interview/public-access";
import { ok, handleError } from "../_lib/respond";

export const dynamic = "force-dynamic";

// GET /api/interview/[token] — public: what the candidate page needs; first call marks the invite opened
export async function GET(request, { params }) {
  try {
    const ctx = await resolveInterviewToken(params.token, { route: "get" });
    const interview = await markOpened(ctx.interview);
    return ok({ interview: await publicInterviewView({ ...ctx, interview }) });
  } catch (error) {
    return handleError(error, "Interview lookup");
  }
}
