import { Play, Pause, X } from "lucide-react";

const CONTROLLABLE_STATUSES = ["processing", "paused", "queued"];

export default function InviteActionBar({
  campaignId,
  campaignName,
  status,
  currentJobId,
  isRunning,
  isProcessing,
  isDark,
  onRunBackground,
  onPause,
  onResume,
  onCancel,
  onBack,
}) {
  const canControl = currentJobId && status && CONTROLLABLE_STATUSES.includes(status.status);
  const isPaused = status?.status === "paused";

  return (
    <div
      className={`absolute left-0 right-0 bottom-0 px-6 h-16 ${
        isDark ? "bg-[#0f172a] border-slate-700" : "bg-slate-50 border-slate-200"
      } border-t flex items-center justify-between backdrop-blur-sm`}
    >
      <div className={`text-xs ${isDark ? "text-slate-300" : "text-slate-600"} max-w-2xl leading-relaxed`}>
        {campaignId ? (
          <>
            Campaign: <span className="font-medium">{campaignName}</span> (ID: {campaignId})
          </>
        ) : (
          <div className="flex items-center gap-2">
            <X className="h-3.5 w-3.5 text-warning" />
            <span>No campaign selected. Please navigate from a campaign to run this workflow.</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button className="btn btn-ghost btn-sm text-slate-400 hover:text-slate-200" onClick={onBack}>
          Back
        </button>

        <button
          className="btn btn-primary btn-sm px-4 font-medium shadow-lg hover:shadow-xl transition-all duration-200"
          onClick={onRunBackground}
          disabled={(currentJobId && CONTROLLABLE_STATUSES.includes(status?.status)) || isRunning || !campaignId}
          title={
            !campaignId
              ? "No campaign selected"
              : currentJobId && CONTROLLABLE_STATUSES.includes(status?.status)
                ? "A workflow is already running"
                : "Run in background (survives browser close)"
          }
        >
          <Play className="h-4 w-4 mr-2" />
          Run Background
        </button>

        <button
          className={`btn btn-sm px-4 font-medium shadow-lg transition-all duration-200 ${
            isPaused ? "btn-success" : "btn-warning"
          }`}
          onClick={isPaused ? onResume : onPause}
          disabled={!canControl}
          title={
            isPaused
              ? "Resume workflow"
              : status?.status === "processing" || status?.status === "queued"
                ? "Pause workflow"
                : "Only available when processing or paused"
          }
        >
          {isPaused ? (
            <>
              <Play className="h-4 w-4 mr-2" />
              Resume
            </>
          ) : (
            <>
              <Pause className="h-4 w-4 mr-2" />
              Stop
            </>
          )}
        </button>

        <button
          className="btn btn-error btn-sm px-4 font-medium shadow-lg transition-all duration-200"
          onClick={onCancel}
          disabled={!canControl || isProcessing}
          title={canControl ? "Permanently cancel workflow" : "No active workflow to cancel"}
        >
          <X className="h-4 w-4 mr-2" />
          Cancel
        </button>
      </div>
    </div>
  );
}

