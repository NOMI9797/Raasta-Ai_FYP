import { resolveInterviewToken } from "@/libs/interview/public-access";
import { signTicket } from "@/libs/interview/tokens";
import { INTERVIEW_STATUS } from "@/libs/hiring/statuses";
import { ok, fail, handleError } from "../../_lib/respond";

function wsUrl(request) {
  const configured = process.env.NEXT_PUBLIC_INTERVIEW_WS_URL;
  if (configured) return configured.replace(/\/$/, "");
  // Same host, engine port (local development)
  const url = new URL(request.url);
  return `${url.protocol === "https:" ? "wss" : "ws"}://${url.hostname}:${process.env.INTERVIEW_ENGINE_PORT || 8090}`;
}

// POST /api/interview/[token]/session — short-lived WebSocket ticket (10 min). Requires consent.
export async function POST(request, { params }) {
  try {
    const { interview } = await resolveInterviewToken(params.token, { route: "session" });
    if (!interview.consentAt) {
      return fail("consent_required", "Please accept the recording and AI evaluation terms first.", 403);
    }
    if (![INTERVIEW_STATUS.OPENED, INTERVIEW_STATUS.IN_PROGRESS].includes(interview.status)) {
      return fail("invalid_state", "This interview can't be started right now. Please reload the page.", 409);
    }
    const ticket = await signTicket({ interviewId: interview.id, candidateId: interview.candidateId });
    return ok({ wsUrl: wsUrl(request), ticket });
  } catch (error) {
    return handleError(error, "Interview session");
  }
}
