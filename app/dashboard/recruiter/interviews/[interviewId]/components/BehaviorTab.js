"use client";

import { AlertTriangle, Eye, Info, Loader2, ScanFace, Users } from "lucide-react";
import { formatClock, formatPercent } from "../../../components/format";

// Colours for the strips: where the candidate looked, and what the face showed
const GAZE = {
  center: { label: "Looking at the screen", bar: "bg-success" },
  left: { label: "Looking left", bar: "bg-warning" },
  right: { label: "Looking right", bar: "bg-warning" },
  up: { label: "Looking up", bar: "bg-info" },
  down: { label: "Looking down", bar: "bg-info" },
  no_face: { label: "Face not visible", bar: "bg-base-300" },
};
const EXPRESSION = {
  neutral: { label: "Neutral", bar: "bg-base-content/25" },
  happy: { label: "Pleased / smiling", bar: "bg-success" },
  surprised: { label: "Surprised", bar: "bg-secondary" },
  concerned: { label: "Concerned", bar: "bg-warning" },
  tense: { label: "Tense", bar: "bg-error" },
};

function Stat({ icon: Icon, label, value, hint }) {
  return (
    <div className="bg-base-200 border border-base-300 rounded-xl p-3">
      <p className="text-xs text-base-content/60 flex items-center gap-1.5">{Icon && <Icon size={13} aria-hidden="true" />}{label}</p>
      <p className="text-xl font-bold tabular-nums mt-0.5">{value ?? "–"}</p>
      {hint && <p className="text-[11px] text-base-content/50 leading-tight">{hint}</p>}
    </div>
  );
}

function Bars({ items, palette }) {
  return (
    <div className="space-y-1.5">
      {items.map(([key, share]) => (
        <div key={key} className="flex items-center gap-2 text-xs">
          <span className="w-36 text-base-content/70 truncate">{palette[key]?.label || key}</span>
          <div className="flex-1 h-2.5 bg-base-300/60 rounded-full overflow-hidden" role="presentation">
            <div className={`h-full ${palette[key]?.bar || "bg-primary"}`} style={{ width: `${Math.min(100, Math.max(0, share))}%` }} />
          </div>
          <span className="w-10 text-right tabular-nums">{Math.round(share)}%</span>
        </div>
      ))}
    </div>
  );
}

/** One coloured cell per point of the timeline; selecting a cell jumps the recording there. */
function Strip({ title, points, field, palette, onSeek, markers = [], total }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-base-content/50 mb-1">{title}</p>
      <div className="relative">
        <div className="flex h-5 rounded overflow-hidden border border-base-300 bg-base-200">
          {points.map((p) => {
            const key = p[field];
            const meta = palette[key];
            return (
              <button
                key={p.t}
                type="button"
                tabIndex={-1}
                title={`${formatClock(p.t)} · ${meta?.label || "Unknown"}`}
                aria-label={`${formatClock(p.t)} ${meta?.label || "unknown"}`}
                className={`${meta?.bar || "bg-base-200"} hover:brightness-110`}
                style={{ flex: "1 1 0", minWidth: 1 }}
                onClick={() => onSeek?.(p.t * 1000)}
              />
            );
          })}
        </div>
        {markers.map((m) => (
          <span
            key={m.key}
            className="absolute -bottom-2 w-px h-2 bg-base-content/60"
            style={{ left: `${Math.min(100, (m.sec / total) * 100)}%` }}
            title={m.label}
          />
        ))}
      </div>
    </div>
  );
}

const FLAG_LABEL = { face_absent: "Face not visible", multiple_faces: "A second face was in view" };

export default function BehaviorTab({ detail, onSeek }) {
  const { interview, turns } = detail;
  const analysis = interview.analysis;
  const behavior = analysis?.behavior;

  if (interview.analysisStatus !== "complete" || !analysis) {
    const working = ["pending", "processing"].includes(interview.analysisStatus) && interview.status === "completed";
    return (
      <div className="bg-base-200 border border-dashed border-base-300 rounded-xl p-8 text-center">
        {working ? <Loader2 className="mx-auto mb-2 animate-spin text-primary" size={22} /> : <ScanFace className="mx-auto mb-2 text-base-content/30" size={24} />}
        <p className="font-semibold">{working ? "The interview is being analysed" : "No behaviour analysis yet"}</p>
        <p className="text-sm text-base-content/60 mt-1">
          {interview.status !== "completed" ? "It is measured from the camera and analysed after the interview is completed." : "This page updates by itself when it is ready."}
        </p>
      </div>
    );
  }

  if (!behavior) {
    return (
      <div className="bg-base-200 border border-dashed border-base-300 rounded-xl p-8 text-center">
        <ScanFace className="mx-auto mb-2 text-base-content/30" size={24} />
        <p className="font-semibold">No camera behaviour was measured</p>
        <p className="text-sm text-base-content/60 mt-1 max-w-xl mx-auto">
          {analysis.errors?.behavior || "Camera tracking was off for this interview."}
        </p>
      </div>
    );
  }

  const { eyeContact, head, blinks, expressions, integrity, timeline = [], perAnswer = [] } = behavior;
  const answering = behavior.answering;
  const headline = answering?.eyeContact || eyeContact;
  const total = Math.max(1, timeline.at(-1)?.t + 2 || behavior.durationSec);
  const gazeBars = Object.entries(eyeContact.distribution || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const expressionBars = Object.entries(expressions.distribution || {}).map(([k, v]) => [k, v * 100]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const answerMarkers = perAnswer.map((a, i) => ({ key: a.id, sec: a.startSec, label: `Answer ${i + 1} · ${formatClock(a.startSec)}` }));
  const textOf = (id) => {
    const turn = turns.find((t) => `turn-${t.seq}` === id);
    const words = String(turn?.text || "").split(/\s+/).slice(0, 9).join(" ");
    return words ? `${words}${String(turn.text).split(/\s+/).length > 9 ? "…" : ""}` : "";
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="alert py-2 text-sm">
        <Info size={16} />
        <span>
          Measured from the candidate&apos;s camera on their own device (no images were sent for this). Treat these as signals, not conclusions:
          expression readings are approximate (speaking moves the face, and lighting and camera angle matter), and none of this says anything about honesty or ability.
          Looking away is often just thinking.
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat icon={Eye} label={answering ? "Looking at the screen (answering)" : "Looking at the screen"} value={headline.score != null ? `${Math.round(headline.score)}%` : null} hint={answering ? `${Math.round(eyeContact.score ?? 0)}% over the whole interview` : undefined} />
        <Stat label="Face visible" value={formatPercent(behavior.faceVisibleRate)} />
        <Stat label="Head steadiness" value={head.stability != null ? `${head.stability}/100` : null} hint={head.movementDegPerSec != null ? `${head.movementDegPerSec} °/s of movement` : undefined} />
        <Stat label="Blinks per minute" value={blinks.perMin} hint="typical is 10 to 25" />
        <Stat label="Most common expression" value={EXPRESSION[expressions.dominant]?.label || "–"} hint={expressions.composure != null ? `${expressions.composure}% calm or pleased` : undefined} />
      </div>

      {timeline.length > 0 && (
        <section className="space-y-3" aria-label="Timeline">
          <h2 className="text-sm font-semibold">Through the interview</h2>
          <Strip title="Where they looked" points={timeline} field="gaze" palette={GAZE} onSeek={onSeek} markers={answerMarkers} total={total} />
          <Strip title="Facial expression" points={timeline} field="expression" palette={EXPRESSION} onSeek={onSeek} total={total} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-base-content/60 pt-1">
            {["center", "left", "up", "no_face"].map((k) => (
              <span key={k} className="flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-sm ${GAZE[k].bar}`} />{k === "left" ? "Looking sideways" : k === "up" ? "Looking up or down" : GAZE[k].label}</span>
            ))}
            <span className="text-base-content/40">Ticks under the first strip mark where each answer began. Select a cell to jump the recording there.</span>
          </div>
        </section>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <section className="bg-base-200 border border-base-300 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold">Eye contact</h2>
          <Bars items={gazeBars} palette={GAZE} />
          <div className="grid grid-cols-3 gap-3 pt-1">
            <div><p className="text-xs text-base-content/60">Looked away</p><p className="text-sm font-semibold tabular-nums">{eyeContact.lookAwayCount} times</p></div>
            <div><p className="text-xs text-base-content/60">Longest</p><p className="text-sm font-semibold tabular-nums">{eyeContact.longestLookAwaySec} s</p></div>
            <div><p className="text-xs text-base-content/60">In total</p><p className="text-sm font-semibold tabular-nums">{eyeContact.totalLookAwaySec} s</p></div>
          </div>
        </section>

        <section className="bg-base-200 border border-base-300 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold">Facial expressions</h2>
          {expressionBars.length ? <Bars items={expressionBars} palette={EXPRESSION} /> : <p className="text-xs text-base-content/50">Not measured.</p>}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div><p className="text-xs text-base-content/60">Smiling</p><p className="text-sm font-semibold tabular-nums">{expressions.smileRate != null ? formatPercent(expressions.smileRate) : "–"}</p></div>
            <div><p className="text-xs text-base-content/60">Calm or pleased</p><p className="text-sm font-semibold tabular-nums">{expressions.composure != null ? `${expressions.composure}%` : "–"}</p></div>
          </div>
        </section>

        <section className="bg-base-200 border border-base-300 rounded-xl p-4 space-y-3 md:col-span-2">
          <h2 className="text-sm font-semibold">Head movement</h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div><p className="text-xs text-base-content/60">Nods</p><p className="text-sm font-semibold tabular-nums">{head.nods}</p></div>
            <div><p className="text-xs text-base-content/60">Head shakes</p><p className="text-sm font-semibold tabular-nums">{head.shakes}</p></div>
            <div><p className="text-xs text-base-content/60">Turn left–right</p><p className="text-sm font-semibold tabular-nums">{head.yawStdDeg != null ? `±${head.yawStdDeg}°` : "–"}</p></div>
            <div><p className="text-xs text-base-content/60">Tip up–down</p><p className="text-sm font-semibold tabular-nums">{head.pitchStdDeg != null ? `±${head.pitchStdDeg}°` : "–"}</p></div>
            <div><p className="text-xs text-base-content/60">Head tilt</p><p className="text-sm font-semibold tabular-nums">{head.tiltAvgDeg != null ? `${head.tiltAvgDeg}°` : "–"}</p></div>
          </div>
        </section>
      </div>

      {perAnswer.length > 0 && (
        <section aria-label="Per answer">
          <h2 className="text-sm font-semibold mb-2">Answer by answer</h2>
          <div className="overflow-x-auto border border-base-300 rounded-xl">
            <table className="table table-sm">
              <thead>
                <tr><th>Answer</th><th className="text-right">Looking at the screen</th><th className="text-right">Looked away</th><th>Expression</th><th className="text-right">Head movement</th></tr>
              </thead>
              <tbody>
                {perAnswer.map((a, i) => (
                  <tr key={a.id} className={a.eyeContact == null ? "opacity-50" : ""}>
                    <td>
                      <button type="button" className="link link-hover text-left" onClick={() => onSeek?.(a.startSec * 1000)} title="Jump to this answer in the recording">
                        <span className="font-medium tabular-nums">{formatClock(a.startSec)}</span>
                        <span className="text-base-content/60"> · {textOf(a.id) || `Answer ${i + 1}`}</span>
                      </button>
                    </td>
                    <td className="text-right tabular-nums">{a.eyeContact != null ? `${Math.round(a.eyeContact)}%` : "–"}</td>
                    <td className="text-right tabular-nums">{a.lookAwayCount ?? "–"}</td>
                    <td>{EXPRESSION[a.dominantExpression]?.label || "–"}</td>
                    <td className="text-right tabular-nums">{a.headMovementDegPerSec != null ? `${a.headMovementDegPerSec} °/s` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-label="Camera integrity signals" className="space-y-2">
        <h2 className="text-sm font-semibold">Camera signals worth a look</h2>
        {integrity.events.length === 0 ? (
          <p className="text-sm text-base-content/60">The face stayed in view throughout, and no second face appeared.</p>
        ) : (
          <ul className="space-y-1">
            {integrity.events.map((e, i) => (
              <li key={`${e.type}-${i}`} className="flex items-center gap-3 text-sm border-b border-base-300/60 py-1.5">
                {e.type === "multiple_faces" ? <Users size={15} className="text-warning" aria-hidden="true" /> : <AlertTriangle size={15} className="text-warning" aria-hidden="true" />}
                <button type="button" className="tabular-nums text-base-content/60 w-14 text-left link link-hover" onClick={() => onSeek?.(e.fromSec * 1000)}>{formatClock(e.fromSec)}</button>
                <span>{FLAG_LABEL[e.type] || e.type}</span>
                <span className="text-xs text-base-content/50 ml-auto">{Math.round(e.durationSec)} s</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
