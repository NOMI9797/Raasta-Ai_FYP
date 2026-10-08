"use client";

import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useDialog } from "@/components/ui/DialogProvider";
import { Download, Film, Loader2, Trash2 } from "lucide-react";
import { formatClock } from "../../../components/format";

/**
 * Audio/video player with a marker for every question. `seek` ({ ms, nonce }) jumps the player,
 * e.g. from a transcript line. Deleting removes the files; scores and the transcript stay.
 */
export default function RecordingTab({ detail, seek, onChanged }) {
  const { confirm } = useDialog();
  const { interview, turns, recording } = detail;
  const mediaRef = useRef(null);
  const [duration, setDuration] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const hasVideo = Boolean(recording.videoUrl);
  const src = recording.videoUrl || recording.audioUrl;

  // Jump to a moment chosen elsewhere (transcript). Waits for the metadata when the player is still loading.
  useEffect(() => {
    const media = mediaRef.current;
    if (!seek || !media) return undefined;
    const go = () => {
      media.currentTime = seek.ms / 1000;
      media.play().catch(() => {}); // the browser may require a click first
    };
    if (media.readyState >= 1) {
      go();
      return undefined;
    }
    media.addEventListener("loadedmetadata", go, { once: true });
    return () => media.removeEventListener("loadedmetadata", go);
  }, [seek, src]);

  const jump = (ms) => {
    const media = mediaRef.current;
    if (!media) return;
    media.currentTime = ms / 1000;
    media.play().catch(() => {});
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: "Delete this recording permanently?",
      message: "The audio and video files are removed. Scores, the transcript and the analysis stay, but the interview can no longer be re-analysed.",
      confirmText: "Delete recording",
      tone: "danger",
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/hiring/interviews/${interview.id}/recording`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete the recording");
      toast.success("Recording deleted");
      await onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeleting(false);
    }
  };

  if (recording.deleted) {
    return (
      <div className="bg-base-200 border border-dashed border-base-300 rounded-xl p-8 text-center">
        <Trash2 className="mx-auto mb-2 text-base-content/30" size={24} />
        <p className="font-semibold">The recording was deleted</p>
        <p className="text-sm text-base-content/60 mt-1">Scores, the transcript and the analysis are still available.</p>
      </div>
    );
  }

  if (!src) {
    const waiting = ["none", "uploading"].includes(recording.status);
    // The parts the candidate's browser sent are kept: a failed join can be tried again
    const received = (recording.parts?.audio || 0) + (recording.parts?.video || 0);
    const failed = recording.status === "failed";
    return (
      <div className="bg-base-200 border border-dashed border-base-300 rounded-xl p-8 text-center">
        {waiting && interview.status === "completed" ? <Loader2 className="mx-auto mb-2 animate-spin text-primary" size={22} /> : <Film className="mx-auto mb-2 text-base-content/30" size={24} />}
        <p className="font-semibold">
          {failed && received > 0 ? "The recording was received but couldn't be put together" : failed ? "No recording was received" : waiting ? "No recording available yet" : "No recording available"}
        </p>
        <p className="text-sm text-base-content/60 mt-1">
          {failed && received > 0
            ? `The candidate's browser uploaded ${received} parts, and they are still stored. Press Re-analyse above to try again.`
            : waiting
              ? "It is joined together after the interview ends."
              : "The candidate's browser didn't upload any audio or video."}
        </p>
        {failed && recording.problem && (
          <p className="text-xs text-error mt-3 max-w-xl mx-auto break-words">{recording.problem}</p>
        )}
      </div>
    );
  }

  // MediaRecorder files can report an infinite length, so fall back to what the interview recorded
  const knownOffsets = turns.map((t) => t.offsetMs).filter((v) => v != null);
  const total = (Number.isFinite(duration) && duration > 0 ? duration : null)
    ?? interview.durationSec
    ?? (knownOffsets.length ? Math.max(...knownOffsets) / 1000 + 30 : null);
  let questionNumber = 0;
  const markers = turns
    .filter((t) => t.speaker === "ai" && ["question", "follow_up"].includes(t.kind) && t.offsetMs != null)
    .map((t) => {
      if (t.kind === "question") questionNumber += 1;
      return { id: t.id, ms: t.offsetMs, label: t.kind === "question" ? `Q${questionNumber}` : "F", follow: t.kind === "follow_up", text: t.text };
    });

  return (
    <div className="space-y-4 max-w-3xl">
      {hasVideo ? (
        <video
          ref={mediaRef}
          key={src}
          src={src}
          controls
          preload="metadata"
          className="w-full rounded-lg bg-black max-h-[28rem]"
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        />
      ) : (
        <audio
          ref={mediaRef}
          key={src}
          src={src}
          controls
          preload="metadata"
          className="w-full"
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        />
      )}

      {markers.length > 0 && total ? (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-base-content/50 mb-1">Questions on the timeline</p>
          <div className="relative h-8 bg-base-200 rounded-lg border border-base-300">
            {markers.map((m) => (
              <button
                key={m.id}
                type="button"
                title={`${m.label} · ${formatClock(m.ms / 1000)} · ${m.text}`}
                aria-label={`${m.label} at ${formatClock(m.ms / 1000)}`}
                className={`absolute top-1 -translate-x-1/2 rounded px-1 text-[10px] font-semibold ${m.follow ? "bg-secondary text-secondary-content h-4 top-2" : "bg-primary text-primary-content h-6"} hover:brightness-110`}
                style={{ left: `${Math.min(98, Math.max(2, (m.ms / 1000 / total) * 100))}%` }}
                onClick={() => jump(m.ms)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-base-content/50 mt-1">Q = question, F = follow-up. Select one to jump there.</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {recording.audioUrl && (
          <a href={recording.audioUrl} className="btn btn-outline btn-sm gap-1" download>
            <Download size={14} /> Audio
          </a>
        )}
        {recording.videoUrl && (
          <a href={recording.videoUrl} className="btn btn-outline btn-sm gap-1" download>
            <Download size={14} /> Video
          </a>
        )}
        <button className="btn btn-ghost btn-sm text-error gap-1 ml-auto" onClick={handleDelete} disabled={deleting}>
          {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete recording
        </button>
      </div>
      <p className="text-xs text-base-content/50">
        Links work for {Math.round(recording.expiresInSec / 60)} minutes. Reload the page for fresh ones. Candidates agreed to the recording before the interview.
      </p>
    </div>
  );
}
