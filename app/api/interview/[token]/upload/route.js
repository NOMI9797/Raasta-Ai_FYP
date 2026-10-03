import { and, eq } from "drizzle-orm";
import { db } from "@/libs/db";
import { interviews } from "@/libs/schema";
import { MAX_PART_BYTES, recordingPartKey, resolveInterviewToken } from "@/libs/interview/public-access";
import { putObject } from "@/libs/hiring/storage";
import { enqueue } from "@/libs/hiring/queue";
import { INTERVIEW_STATUS } from "@/libs/hiring/statuses";
import { ok, fail, handleError } from "../../_lib/respond";

const KINDS = new Set(["audio", "video"]);
const MAX_PART_INDEX = 99999;

// POST /api/interview/[token]/upload — multipart: kind (audio|video), part (int), final (bool), file (≤ 10 MB)
export async function POST(request, { params }) {
  try {
    const { interview } = await resolveInterviewToken(params.token, { route: "upload", allowCompleted: true });
    if (![INTERVIEW_STATUS.OPENED, INTERVIEW_STATUS.IN_PROGRESS, INTERVIEW_STATUS.COMPLETED].includes(interview.status)) {
      return fail("invalid_state", "Recording isn't open for this interview.", 409);
    }
    if (!interview.consentAt) return fail("consent_required", "Consent is required before recording.", 403);

    const length = Number(request.headers.get("content-length") || 0);
    if (length > MAX_PART_BYTES + 64 * 1024) return fail("too_large", "Recording part is too large (max 10 MB).", 413);

    const form = await request.formData();
    const kind = String(form.get("kind") || "");
    const part = Number(form.get("part"));
    const final = ["true", "1"].includes(String(form.get("final") || "").toLowerCase());
    const file = form.get("file");

    if (!KINDS.has(kind)) return fail("invalid_kind", "kind must be audio or video", 400);
    if (!Number.isInteger(part) || part < 0 || part > MAX_PART_INDEX) return fail("invalid_part", "part must be a whole number", 400);
    if (!file || typeof file.arrayBuffer !== "function") return fail("missing_file", "file is required", 400);
    if (file.size > MAX_PART_BYTES) return fail("too_large", "Recording part is too large (max 10 MB).", 413);
    const type = String(file.type || "");
    if (type && !/^(audio|video)\/webm\b/i.test(type) && type !== "application/octet-stream") {
      return fail("invalid_type", "Recording parts must be WebM", 415);
    }

    const key = recordingPartKey(interview.id, kind, part);
    if (file.size > 0) {
      await putObject(key, Buffer.from(await file.arrayBuffer()), kind === "audio" ? "audio/webm" : "video/webm");
    }

    // First part: uploading. The worker sets complete once the parts are assembled (Phase 7).
    await db.update(interviews)
      .set({ recordingStatus: "uploading", updatedAt: new Date() })
      .where(and(eq(interviews.id, interview.id), eq(interviews.recordingStatus, "none")));

    if (final) {
      try {
        await enqueue("assemble-recording", { interviewId: interview.id, kind, parts: part + 1 });
      } catch (error) {
        console.error("Failed to queue recording assembly:", error?.message);
      }
    }
    return ok({ stored: file.size > 0, part, final });
  } catch (error) {
    return handleError(error, "Recording upload");
  }
}
