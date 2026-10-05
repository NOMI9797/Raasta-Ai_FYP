"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { formatPercent } from "../../../components/format";

const ERROR_LABELS = { voice: "Speaking pace and fluency", emotion: "Tone of voice", gaze: "Eye contact", face: "Facial expression" };
const EMOTION_BAR = {
  neutral: "progress-info", calm: "progress-info", happy: "progress-success",
  sad: "progress-warning", angry: "progress-error", fear: "progress-warning", disgust: "progress-error", surprise: "progress-secondary",
};

function Card({ title, score, weight, children }) {
  return (
    <div className="bg-base-200 border border-base-300 rounded-xl p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-sm">{title}</p>
        <div className="text-right">
          <p className="text-xl font-bold tabular-nums leading-none">{score ?? "–"}</p>
          {weight != null && <p className="text-[11px] text-base-content/50">{Math.round(weight * 100)}% of communication</p>}
        </div>
      </div>
      {score != null && <progress className="progress progress-primary w-full" value={score} max="100" aria-label={`${title} score`} />}
      {children}
    </div>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div>
      <p className="text-xs text-base-content/60">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value ?? "–"}</p>
      {hint && <p className="text-[11px] text-base-content/40">{hint}</p>}
    </div>
  );
}

export default function CommunicationTab({ detail }) {
  const { interview, candidate } = detail;
  const analysis = interview.analysis;
  const comm = candidate?.finalAnalysis?.communication;

  if (interview.analysisStatus !== "complete" || !analysis) {
    const working = ["pending", "processing"].includes(interview.analysisStatus) && interview.status === "completed";
    return (
      <div className="bg-base-200 border border-dashed border-base-300 rounded-xl p-8 text-center">
        {working ? <Loader2 className="mx-auto mb-2 animate-spin text-primary" size={22} /> : <AlertTriangle className="mx-auto mb-2 text-warning" size={22} />}
        <p className="font-semibold">
          {working ? "The recording is being analysed" : interview.analysisStatus === "failed" ? "The analysis failed" : "No analysis yet"}
        </p>
        <p className="text-sm text-base-content/60 mt-1">
          {interview.status !== "completed" ? "Analysis starts after the interview is completed." : "This page updates by itself when it is ready."}
        </p>
      </div>
    );
  }

  const { voice, emotion, gaze, face, errors = {} } = analysis;
  const components = comm?.components || {};
  const weights = comm?.weights || {};
  const distribution = Object.entries(emotion?.distribution || {}).sort((a, b) => b[1] - a[1]);
  const notes = Object.entries(errors).filter(([, reason]) => reason && reason !== "disabled");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="bg-base-200 border border-base-300 rounded-xl px-5 py-3">
          <p className="text-xs text-base-content/60">Communication score</p>
          <p className="text-3xl font-bold tabular-nums">{interview.communicationScore ?? comm?.score ?? "–"}</p>
        </div>
        <p className="text-sm text-base-content/60 max-w-xl">
          Made from speaking pace, fluency, eye contact and tone of voice. Anything that couldn&apos;t be measured is left out and the other parts count for more.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Speaking pace" score={components.pace} weight={weights.pace}>
          {voice ? (
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Words per minute" value={voice.wpm != null ? Math.round(voice.wpm) : null} hint="Best between 110 and 160" />
              <Stat label="Speaking time" value={voice.durationSec != null ? `${Math.round(voice.durationSec)} s` : null} />
            </div>
          ) : <p className="text-xs text-base-content/50">Not measured.</p>}
        </Card>

        <Card title="Fluency" score={components.fluency} weight={weights.fluency}>
          {voice ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Fillers per minute" value={voice.fillerPerMin != null ? voice.fillerPerMin.toFixed(1) : null} />
                <Stat label="Time in pauses" value={formatPercent(voice.pauseRatio)} />
                <Stat label="Long pauses" value={voice.longPauses ?? voice.pauseCount} hint={voice.longestPauseSec != null ? `longest ${voice.longestPauseSec.toFixed(1)} s` : undefined} />
              </div>
              {voice.fillerTop?.length > 0 && (
                <div className="flex flex-wrap gap-1 items-center">
                  <span className="text-xs text-base-content/60 mr-1">Most used fillers</span>
                  {voice.fillerTop.map((f) => <span key={f} className="badge badge-sm badge-outline">{f}</span>)}
                </div>
              )}
            </>
          ) : <p className="text-xs text-base-content/50">Not measured.</p>}
        </Card>

        <Card title="Eye contact" score={components.eyeContact} weight={weights.eyeContact}>
          {gaze ? (
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Looking at the camera" value={gaze.eyeContactScore != null ? `${Math.round(gaze.eyeContactScore)}%` : null} />
              <Stat label="Attention" value={gaze.attentionScore != null ? `${Math.round(gaze.attentionScore)}%` : null} />
              <Stat label="Looked away" value={gaze.lookAwayCount != null ? `${gaze.lookAwayCount} times` : null} hint={gaze.longestLookAwaySec != null ? `longest ${gaze.longestLookAwaySec.toFixed(1)} s` : undefined} />
              <Stat label="Face visible" value={formatPercent(gaze.faceDetectionRate)} />
            </div>
          ) : <p className="text-xs text-base-content/50">Not measured{errors.gaze ? `: ${errors.gaze}` : ""}.</p>}
        </Card>

        <Card title="Tone of voice" score={components.composure} weight={weights.composure}>
          {emotion ? (
            <div className="space-y-1.5">
              <p className="text-xs text-base-content/60">Mostly <span className="font-semibold text-base-content">{emotion.dominant}</span>{emotion.confidenceAvg != null ? ` (model confidence ${formatPercent(emotion.confidenceAvg)})` : ""}</p>
              {distribution.slice(0, 5).map(([label, share]) => (
                <div key={label} className="flex items-center gap-2 text-xs">
                  <span className="w-16 capitalize text-base-content/70">{label}</span>
                  <progress className={`progress flex-1 ${EMOTION_BAR[label] || "progress-primary"}`} value={Math.round(share * 100)} max="100" aria-label={`${label} share`} />
                  <span className="w-9 text-right tabular-nums">{formatPercent(share)}</span>
                </div>
              ))}
              {face?.dominant && <p className="text-xs text-base-content/60 pt-1">Facial expression: mostly {face.dominant}</p>}
            </div>
          ) : <p className="text-xs text-base-content/50">Not measured.</p>}
        </Card>
      </div>

      {notes.length > 0 && (
        <div className="text-xs text-base-content/60 space-y-0.5">
          {notes.map(([key, reason]) => <p key={key}>{ERROR_LABELS[key] || key}: {reason}</p>)}
        </div>
      )}
    </div>
  );
}
