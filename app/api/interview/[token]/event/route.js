import { resolveInterviewToken } from "@/libs/interview/public-access";
import { recordIntegrityEvent } from "@/libs/interview/repository";
import { INTERVIEW_STATUS } from "@/libs/hiring/statuses";
import { ok, fail, handleError } from "../../_lib/respond";

const EVENTS = new Set(["tab_hidden", "tab_visible", "mic_muted", "mic_unmuted", "net_offline", "net_online", "fullscreen_exit"]);

// POST /api/interview/[token]/event — integrity events when the WebSocket is down. Body { event, at }
export async function POST(request, { params }) {
  try {
    const { interview } = await resolveInterviewToken(params.token, { route: "event" });
    const body = await request.json().catch(() => ({}));
    if (!EVENTS.has(body?.event)) return fail("invalid_event", "Unknown event", 400);
    if (![INTERVIEW_STATUS.OPENED, INTERVIEW_STATUS.IN_PROGRESS].includes(interview.status)) return ok({ recorded: false });
    const at = new Date(body.at || Date.now());
    await recordIntegrityEvent(interview.id, {
      type: body.event,
      at: (Number.isNaN(at.getTime()) ? new Date() : at).toISOString(),
      via: "http",
    });
    return ok({ recorded: true });
  } catch (error) {
    return handleError(error, "Interview event");
  }
}
