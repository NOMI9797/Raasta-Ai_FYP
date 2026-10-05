"use client";

import { Bot, PlayCircle, User } from "lucide-react";
import { formatClock } from "../../../components/format";

const KIND_LABEL = {
  greeting: "Greeting",
  question: "Question",
  follow_up: "Follow-up",
  answer: "Answer",
  closing: "Closing",
  system: "System",
};

/**
 * Chat-style transcript. Turns with a known offset can jump the recording to that moment.
 */
export default function TranscriptTab({ detail, onSeek }) {
  const { turns, candidate, recording } = detail;
  const canSeek = Boolean(recording.audioUrl || recording.videoUrl);

  if (!turns.length) {
    return (
      <div className="bg-base-200 border border-dashed border-base-300 rounded-xl p-8 text-center">
        <p className="font-semibold">No transcript yet</p>
        <p className="text-sm text-base-content/60 mt-1">The conversation appears here once the interview starts.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 max-w-3xl">
      {canSeek && <p className="text-xs text-base-content/60">Select a time to jump to that moment in the recording.</p>}
      {turns.map((turn) => {
        const ai = turn.speaker === "ai";
        const seconds = turn.offsetMs != null ? turn.offsetMs / 1000 : null;
        return (
          <div key={turn.id} className={`chat ${ai ? "chat-start" : "chat-end"}`}>
            <div className="chat-header text-xs text-base-content/60 flex items-center gap-1.5 mb-0.5">
              {ai ? <Bot size={12} /> : <User size={12} />}
              {ai ? "Raasta AI Interviewer" : candidate?.name || "Candidate"}
              <span className="badge badge-ghost badge-xs">{KIND_LABEL[turn.kind] || turn.kind}</span>
              {seconds != null && (
                canSeek ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-0.5 text-primary hover:underline tabular-nums"
                    onClick={() => onSeek(turn.offsetMs)}
                    aria-label={`Play the recording from ${formatClock(seconds)}`}
                  >
                    <PlayCircle size={12} />{formatClock(seconds)}
                  </button>
                ) : (
                  <span className="tabular-nums">{formatClock(seconds)}</span>
                )
              )}
            </div>
            <div className={`chat-bubble text-sm whitespace-pre-wrap ${ai ? "" : "chat-bubble-primary"}`}>{turn.text}</div>
          </div>
        );
      })}
    </div>
  );
}
