"use client";

import { Info } from "lucide-react";
import { formatClock } from "../../../components/format";

const EVENT_LABEL = {
  tab_hidden: "Left the interview tab",
  tab_visible: "Came back to the tab",
  mic_muted: "Muted the microphone",
  net_offline: "Lost the internet connection",
  non_english_speech: "Spoke a language other than English (reminded to answer in English)",
};

export default function IntegrityTab({ detail }) {
  const { interview } = detail;
  const summary = interview.analysis?.integrity;
  const camera = interview.analysis?.behavior?.integrity;
  const events = (Array.isArray(interview.integrityEvents) ? interview.integrityEvents : [])
    .filter((e) => e?.at)
    .sort((a, b) => new Date(a.at) - new Date(b.at));
  const startedAt = interview.startedAt ? new Date(interview.startedAt).getTime() : null;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="alert py-2 text-sm">
        <Info size={16} />
        <span>
          These are signals, not proof of misconduct. People switch tabs to check the time, read a message or fix a problem.
          Use them as a reason to look closer, not to decide.
        </span>
      </div>

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          {[
            ["Times the tab was left", summary.tabHiddenCount],
            ["Total time away", summary.tabHiddenSec != null ? `${summary.tabHiddenSec} s` : null],
            ["Microphone muted", summary.micMutedCount],
            ["Connection lost", summary.offlineCount],
            ["Reminded to use English", summary.languageNoticeCount],
            ...(camera ? [["Face out of view", camera.faceAbsentCount], ["Second face in view", camera.multipleFacesCount]] : []),
          ].map(([label, value]) => (
            <div key={label} className="bg-base-200 border border-base-300 rounded-lg p-3">
              <p className="text-xs text-base-content/60">{label}</p>
              <p className="text-xl font-bold tabular-nums">{value ?? "–"}</p>
            </div>
          ))}
        </div>
      )}

      {events.length === 0 ? (
        <div className="bg-base-200 border border-dashed border-base-300 rounded-xl p-8 text-center">
          <p className="font-semibold">Nothing unusual recorded</p>
          <p className="text-sm text-base-content/60 mt-1">No tab switches, muted microphone or lost connection during this interview.</p>
        </div>
      ) : (
        <ol className="space-y-1">
          {events.map((e, i) => (
            <li key={`${e.at}-${i}`} className="flex items-center gap-3 text-sm border-b border-base-300/60 py-1.5">
              <span className="tabular-nums text-base-content/60 w-14">
                {startedAt ? formatClock((new Date(e.at).getTime() - startedAt) / 1000) : "–"}
              </span>
              <span>{EVENT_LABEL[e.type] || e.type}</span>
              <span className="text-xs text-base-content/40 ml-auto">{new Date(e.at).toLocaleTimeString()}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
