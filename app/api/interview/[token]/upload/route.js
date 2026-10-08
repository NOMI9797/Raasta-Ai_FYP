import { and, eq } from "drizzle-orm";
import { db } from "@/libs/db";
import { interviews } from "@/libs/schema";
import { MAX_PART_BYTES, recordingPartKey, resolveInterviewToken } from "@/libs/interview/public-access";
import { putObject } from "@/libs/hiring/storage";
import { enqueue } from "@/libs/hiring/queue";
import { INTERVIEW_STATUS } from "@/libs/hiring/statuses";
import { behaviorPartKey, normaliseBatch } from "@/libs/interview/behavior";
import { ok, fail, handleError } from "../../_lib/respond";

const KINDS = new Set(["audio", "video", "behavior"]);
const MAX_PART_INDEX = 99999;
const MAX_BEHAVIOR_BYTES = 1024 * 1024; // a 15 s batch of numbers is a few KB

// Camera behaviour batches: small JSON documents of numbers (never images). Stored with the time the
// server received them, which lets the analysis correct for a candidate's wrong clock.
async function storeBehavior(interview, part, file) {
  if (file.size === 0 || file.size > MAX_BEHAVIOR_BYTES) return fail("invalid_file", "Behaviour data has an unusable size.", 400);
  let doc;
  try {
    doc = JSON.parse(await file.text());
  } catch {
    return fail("invalid_file", "Behaviour data must be JSON.", 400);
  }
  let stored;
  if (typeof doc?.unavailable === "string") {
    // The browser could not start tracking: keep the reason so the recruiter's report can say so
    stored = { receivedAt: Date.now(), unavailable: doc.unavailable.slice(0, 200) };
  } else {
    const batch = normaliseBatch(doc);
    if (!batch) return fail("invalid_batch", "Unusable behaviour data.", 400);
    stored = { receivedAt: Date.now(), batch };
  }
  await putObject(behaviorPartKey(interview.id, part), Buffer.from(JSON.stringify(stored)), "application/json");
  return ok({ stored: true, part });
}

// POST /api/interview/[token]/upload — multipart: kind (audio|video|behavior), part (int), final (bool), file (≤ 10 MB)
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
    if (kind === "behavior") return await storeBehavior(interview, part, file);
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
