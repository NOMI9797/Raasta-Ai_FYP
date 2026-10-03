"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { CheckCircle2, Play, Repeat, WifiOff } from "lucide-react";
import { InterviewSocket } from "../lib/interview-socket";
import { UploadQueue } from "../lib/upload-queue";
import { startRecorders } from "../lib/recorders";
import { speak, startMicPipeline } from "../lib/audio";
import InterviewerOrb from "./InterviewerOrb";

const MAX_REPEATS = 2;
const MIN_ANSWER_WORDS = 3;

const CHIP = {
  connecting: { label: "Connecting…", className: "badge-ghost" },
  speaking: { label: "Interviewer speaking", className: "badge-primary" },
  listening: { label: "Listening…", className: "badge-success" },
  thinking: { label: "Thinking…", className: "badge-warning" },
};

function formatClock(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

export default function InterviewRoom({ token, info, media, onComplete, onFatal }) {
  const [phase, setPhase] = useState("connecting");
  const [question, setQuestion] = useState(null);       // { index, total, text, kind }
  const [aiText, setAiText] = useState("");
  const [finals, setFinals] = useState([]);              // candidate captions for the current answer
  const [partial, setPartial] = useState("");
  const [repeatsUsed, setRepeatsUsed] = useState(0);
  const [remainingSec, setRemainingSec] = useState(info.maxMinutes * 60);
  const [reconnecting, setReconnecting] = useState(false);

  const socketRef = useRef(null);
  const queueRef = useRef(null);
  const recordersRef = useRef(null);
  const pipelineRef = useRef(null);
  const speechRef = useRef(null);       // { turnId, stop }
  const completedRef = useRef(false);
  const deadlineRef = useRef(null);     // ms epoch when the time budget ends
  const selfViewRef = useRef(null);
  const handlersRef = useRef({});
  const reconnectingRef = useRef(false);
  const questionRef = useRef(null);

  const finish = useCallback(async () => {
    if (completedRef.current) return;
    completedRef.current = true;
    speechRef.current?.stop();
    pipelineRef.current?.close();
    socketRef.current?.close();
    try {
      await recordersRef.current?.stop(); // queues the final parts
    } catch {
      // recorder already stopped
    }
    onComplete(queueRef.current);
  }, [onComplete]);

  const playUtterance = useCallback(async (msg) => {
    speechRef.current?.stop();
    setPhase("speaking");
    setAiText(msg.text);
    const playback = speak(media.ctx, { audio: msg.audio, text: msg.text });
    speechRef.current = { turnId: msg.turnId, stop: playback.stop };
    await playback.done;
    if (speechRef.current?.turnId !== msg.turnId) return; // replaced by a newer utterance
    speechRef.current = null;
    socketRef.current?.send("ai_done_speaking", { turnId: msg.turnId });
  }, [media.ctx]);

  // Latest handlers for the socket callbacks (avoids stale closures)
  handlersRef.current.onMessage = (msg) => {
    switch (msg.type) {
      case "session_ready":
        if (Number.isFinite(msg.remainingSec)) deadlineRef.current = Date.now() + msg.remainingSec * 1000;
        socketRef.current.send("ready", {
          ua: navigator.userAgent,
          devices: { mic: media.stream.getAudioTracks().length > 0, cam: media.stream.getVideoTracks().length > 0 },
        });
        break;
      case "ai_speaking":
        playUtterance(msg);
        break;
      case "question":
        {
          const prev = questionRef.current;
          if (!prev || prev.index !== msg.index || prev.kind !== msg.kind || prev.text !== msg.text) setRepeatsUsed(0);
          questionRef.current = msg;
          setQuestion(msg);
        }
        setFinals([]);
        setPartial("");
        break;
      case "listening":
        setPhase("listening");
        break;
      case "processing":
        setPhase("thinking");
        setPartial("");
        break;
      case "caption_partial":
        setPartial(msg.text);
        break;
      case "caption_final":
        setFinals((prev) => [...prev, msg.text]);
        setPartial("");
        break;
      case "time_warning":
        toast(`${msg.minutesLeft} minute${msg.minutesLeft === 1 ? "" : "s"} left`, { icon: "⏱️", duration: 5000 });
        break;
      case "interview_complete":
        finish();
        break;
      case "error":
        if (msg.code === "stt_unavailable") toast.error("Speech recognition is having trouble. Keep going — we'll retry.");
        else if (msg.code === "invalid_state") toast(msg.message);
        else if (msg.code !== "duplicate_session") toast.error(msg.message || "Something went wrong.");
        break;
      default:
    }
  };

  handlersRef.current.onStatus = (status, detail = {}) => {
    if (completedRef.current) return;
    if (status === "open") {
      if (reconnectingRef.current) toast.success("Reconnected");
      reconnectingRef.current = false;
      setReconnecting(false);
    } else if (status === "reconnecting") {
      reconnectingRef.current = true;
      setReconnecting(true);
      speechRef.current?.stop();
      setPhase("connecting");
    } else if (status === "failed") {
      onFatal({ code: detail.code || "connection_lost", message: detail.message });
    }
  };

  // Start: mic pipeline → recorders → socket
  useEffect(() => {
    let disposed = false;
    const queue = new UploadQueue(token);
    queueRef.current = queue;
    const socket = new InterviewSocket(token, {
      onMessage: (msg) => handlersRef.current.onMessage(msg),
      onStatus: (status, detail) => handlersRef.current.onStatus(status, detail),
    });
    socketRef.current = socket;

    (async () => {
      try {
        const pipeline = await startMicPipeline(media.ctx, media.stream, (buffer) => socket.sendAudio(buffer));
        if (disposed) {
          pipeline.close();
          return;
        }
        pipelineRef.current = pipeline;
        recordersRef.current = startRecorders(media.stream, { recordVideo: info.recordVideo, queue, firstPart: info.nextRecordingPart });
        await socket.connect();
      } catch (error) {
        if (!disposed) onFatal({ code: "internal", message: "We couldn't start your microphone. Please reload the page." });
      }
    })();

    return () => {
      disposed = true;
      socket.close();
      pipelineRef.current?.close();
      speechRef.current?.stop();
      if (!completedRef.current) recordersRef.current?.stop().catch(() => {});
    };
    // Run once per mounted room
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Countdown
  useEffect(() => {
    const timer = setInterval(() => {
      if (deadlineRef.current) setRemainingSec(Math.max(0, (deadlineRef.current - Date.now()) / 1000));
    }, 500);
    return () => clearInterval(timer);
  }, []);

  // Self view
  useEffect(() => {
    if (selfViewRef.current && media.stream.getVideoTracks().length) selfViewRef.current.srcObject = media.stream;
  }, [media.stream]);

  // Integrity: tab visibility (WebSocket, or HTTP when the socket is down)
  useEffect(() => {
    const report = (event) => {
      const payload = { event, at: new Date().toISOString() };
      if (!socketRef.current?.send("client_event", payload)) {
        fetch(`/api/interview/${encodeURIComponent(token)}/event`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          keepalive: true,
        }).catch(() => {});
      }
    };
    const onVisibility = () => report(document.hidden ? "tab_hidden" : "tab_visible");
    const onOffline = () => report("net_offline");
    const onOnline = () => report("net_online");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [token]);

  // Warn before leaving mid-interview
  useEffect(() => {
    const onBeforeUnload = (event) => {
      if (completedRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const answerText = [...finals, partial].join(" ").trim();
  const canFinish = phase === "listening" && wordCount(answerText) >= MIN_ANSWER_WORDS;
  const canRepeat = Boolean(question) && (phase === "listening" || phase === "speaking") && repeatsUsed < MAX_REPEATS;
  const chip = CHIP[phase] || CHIP.connecting;
  const lowTime = remainingSec <= 60;

  return (
    <div className="flex-1 flex flex-col">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-3 justify-between px-6 py-3 bg-base-100 border-y border-base-300">
        <div className="font-semibold truncate">{info.jobTitle}</div>
        <div className="flex items-center gap-4 text-sm">
          {question && <span>Question {question.index} of {question.total}</span>}
          <span className={`font-mono ${lowTime ? "text-error font-bold" : ""}`} aria-label="Time remaining">{formatClock(remainingSec)}</span>
          <span className="flex items-center gap-1.5 text-error" aria-label="Recording">
            <span className="w-2.5 h-2.5 rounded-full bg-error animate-pulse" /> REC
          </span>
        </div>
      </div>

      {reconnecting && (
        <div role="status" className="alert alert-warning rounded-none justify-center">
          <WifiOff className="w-5 h-5" aria-hidden="true" />
          <span>Reconnecting… your interview will continue where it stopped.</span>
        </div>
      )}

      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6 relative">
        <InterviewerOrb active={phase === "speaking"} listening={phase === "listening"} />
        <span className={`badge badge-lg ${chip.className}`} aria-live="polite">{chip.label}</span>

        <div className="max-w-2xl w-full text-center min-h-[3.5rem]">
          {question?.kind === "follow_up" && <div className="text-xs uppercase tracking-wide text-base-content/50 mb-1">Follow-up</div>}
          <p className="text-xl font-medium">{question?.text || aiText}</p>
        </div>

        {/* Live captions */}
        <div className="max-w-2xl w-full bg-base-100 rounded-xl p-4 min-h-[5.5rem]" aria-live="polite" aria-label="Your answer (live captions)">
          <div className="text-xs uppercase tracking-wide text-base-content/50 mb-1">Your answer</div>
          {answerText ? (
            <p>
              {finals.join(" ")}{" "}
              {partial && <span className="text-base-content/50">{partial}</span>}
            </p>
          ) : (
            <p className="text-base-content/40">{phase === "listening" ? "Start speaking…" : " "}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-3 justify-center">
          {!question && phase !== "connecting" && (
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={() => {
                speechRef.current?.stop();
                setPhase("thinking");
                socketRef.current?.send("begin");
              }}
            >
              <Play className="w-5 h-5" aria-hidden="true" />
              I&apos;m ready, start
            </button>
          )}
          {question && (
          <>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={!canFinish}
            onClick={() => {
              setPhase("thinking");
              socketRef.current?.send("answer_done");
            }}
          >
            <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
            I&apos;ve finished my answer
          </button>
          <button
            type="button"
            className="btn btn-outline btn-lg"
            disabled={!canRepeat}
            onClick={() => {
              setRepeatsUsed((n) => n + 1);
              setFinals([]);
              setPartial("");
              socketRef.current?.send("repeat_question");
            }}
          >
            <Repeat className="w-5 h-5" aria-hidden="true" />
            Repeat question{repeatsUsed > 0 ? ` (${MAX_REPEATS - repeatsUsed} left)` : ""}
          </button>
          </>
          )}
        </div>

        {info.recordVideo && media.stream.getVideoTracks().length > 0 && (
          <video
            ref={selfViewRef}
            autoPlay
            muted
            playsInline
            className="absolute bottom-4 right-4 w-40 rounded-lg shadow-lg bg-base-300 aspect-video object-cover -scale-x-100"
            aria-label="Your camera"
          />
        )}
      </div>
    </div>
  );
}
