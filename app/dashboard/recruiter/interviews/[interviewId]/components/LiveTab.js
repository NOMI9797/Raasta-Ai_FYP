"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Radio, ShieldAlert, User, WifiOff } from "lucide-react";
import ScoreBadge from "../../../components/ScoreBadge";

const INTEGRITY_LABEL = {
  tab_hidden: "Left the interview tab",
  tab_visible: "Came back to the tab",
  mic_muted: "Muted the microphone",
  net_offline: "Lost the internet connection",
};
const STATUS_NOTE = {
  disconnected: "The candidate's connection dropped. They have a few minutes to rejoin.",
  time_up: "Time is up.",
};
const FINISHED = ["completed", "abandoned"];
const MAX_FEED = 200;

// The feed starts from the transcript saved so far, then grows with live events
function feedFromTurns(turns) {
  return turns.map((t) => ({ key: `turn-${t.id}`, kind: t.speaker === "ai" ? "ai" : "candidate", text: t.text, label: t.kind }));
}

/**
 * Read-only live view of an interview in progress. Everything arrives over server-sent events
 * from /api/hiring/interviews/[id]/stream; nothing here can affect the interview.
 */
export default function LiveTab({ detail, onFinished }) {
  const { interview } = detail;
  const [feed, setFeed] = useState(() => feedFromTurns(detail.turns));
  const [scores, setScores] = useState({}); // by response id, for answers scored while watching
  const [pending, setPending] = useState(""); // what the candidate is saying right now
  const [question, setQuestion] = useState(null); // { index, total, text, kind }
  const [note, setNote] = useState(null);
  const [connection, setConnection] = useState("connecting"); // connecting | live | lost | unavailable
  const endRef = useRef(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    const source = new EventSource(`/api/hiring/interviews/${interview.id}/stream`);
    const add = (item) => setFeed((prev) => [...prev, item].slice(-MAX_FEED));

    source.onopen = () => setConnection("live");
    source.onerror = () => setConnection((c) => (c === "unavailable" ? c : "lost"));
    source.onmessage = (message) => {
      let event;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      switch (event.type) {
        case "connected":
          setConnection("live");
          break;
        case "error":
          // The server can't relay events; stop retrying
          setConnection("unavailable");
          source.close();
          break;
        case "question":
          setQuestion({ index: event.index, total: event.total, text: event.text, kind: event.kind });
          add({ key: `q-${event.at}-${event.index}`, kind: "ai", text: event.text, label: event.kind });
          setPending("");
          break;
        case "caption_final":
          setPending((prev) => `${prev} ${event.text}`.trim());
          break;
        case "answer_finalized":
          add({ key: `a-${event.responseId}`, kind: "candidate", text: event.text, label: event.isFollowUp ? "follow-up answer" : "answer", responseId: event.responseId });
          setPending("");
          break;
        case "answer_scored":
          setScores((prev) => ({ ...prev, [event.responseId]: { score: event.score, reasoning: event.reasoning, fallback: event.fallback } }));
          break;
        case "integrity":
          add({ key: `i-${event.at}-${event.event}`, kind: "integrity", text: INTEGRITY_LABEL[event.event] || event.event });
          break;
        case "status":
          setNote(STATUS_NOTE[event.status] || null);
          if (FINISHED.includes(event.status) && !finishedRef.current) {
            finishedRef.current = true;
            source.close();
            onFinished();
          }
          break;
        default:
          break;
      }
    };
    return () => source.close();
  }, [interview.id, onFinished]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [feed.length, pending]);

  const lastQuestion = question || (() => {
    const last = [...feed].reverse().find((f) => f.kind === "ai");
    return last ? { text: last.text } : null;
  })();

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {connection === "live" && <span className="badge badge-accent gap-1"><Radio size={12} className="animate-pulse" /> Live</span>}
        {connection === "connecting" && <span className="badge badge-ghost">Connecting…</span>}
        {connection === "lost" && <span className="badge badge-warning gap-1"><WifiOff size={12} /> Reconnecting…</span>}
        {connection === "unavailable" && <span className="badge badge-error gap-1"><WifiOff size={12} /> Live updates unavailable</span>}
        <span className="text-base-content/60">Read-only: nothing you do here affects the interview.</span>
      </div>

      {note && <div className="alert alert-warning py-2 text-sm">{note}</div>}

      <div className="bg-base-200 border border-base-300 rounded-xl p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-base-content/50 mb-1">
          {question?.total && question.index ? `Question ${question.index} of ${question.total}` : "Current question"}
          {question?.kind === "follow_up" ? " · follow-up" : ""}
        </p>
        <p className="text-sm">{lastQuestion?.text || "Waiting for the first question…"}</p>
      </div>

      <div className="space-y-2" aria-live="polite">
        {feed.map((item) => {
          if (item.kind === "integrity") {
            return (
              <p key={item.key} className="flex items-center gap-1.5 text-xs text-warning">
                <ShieldAlert size={13} /> {item.text}
              </p>
            );
          }
          const ai = item.kind === "ai";
          const score = item.responseId ? scores[item.responseId] : null;
          return (
            <div key={item.key} className={`chat ${ai ? "chat-start" : "chat-end"}`}>
              <div className="chat-header text-xs text-base-content/60 flex items-center gap-1.5 mb-0.5">
                {ai ? <Bot size={12} /> : <User size={12} />}
                {ai ? "Raasta AI Interviewer" : "Candidate"}
                {item.label && <span className="badge badge-ghost badge-xs">{String(item.label).replace("_", " ")}</span>}
                {score && <ScoreBadge label="Score" score={score.score} size="badge-xs" title={score.reasoning || "Answer score"} />}
              </div>
              <div className={`chat-bubble text-sm whitespace-pre-wrap ${ai ? "" : "chat-bubble-primary"}`}>{item.text}</div>
            </div>
          );
        })}
        {pending && (
          <div className="chat chat-end opacity-70">
            <div className="chat-header text-xs text-base-content/60 mb-0.5">Candidate · speaking…</div>
            <div className="chat-bubble chat-bubble-primary text-sm">{pending}</div>
          </div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
