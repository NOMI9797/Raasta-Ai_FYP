import { getStageDescription } from "../constants/stageDescriptions";

export default function InviteProgressCard({ progress, isProcessing, preflightStage }) {
  // Show progress bar if processing OR if we're in preflight stage
  const showProgress = isProcessing || preflightStage;

  if (!showProgress) {
    return null;
  }

  const label = preflightStage
    ? getStageDescription(preflightStage)
    : progress.stage
      ? getStageDescription(progress.stage)
      : progress.current === 0 && progress.total === 1
        ? "Connecting..."
        : "Processing...";

  const percentage =
    preflightStage || (progress.current === 0 && progress.total === 1)
      ? "..."
      : progress.total > 1
        ? `${Math.ceil(progress.current)}/${progress.total} (${Math.round((progress.current / progress.total) * 100)}%)`
        : "...";

  const width =
    preflightStage
      ? "15%" // Show 15% during preflight stages
      : progress.current === 0 && progress.total === 1
        ? "10%"
        : progress.total > 1
          ? `${Math.max(5, (progress.current / progress.total) * 100)}%`
          : "10%";

  return (
    <div className="absolute top-4 right-4 z-[100] w-80">
      <div className="bg-base-100 rounded-lg shadow-xl border border-base-300 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-base-content flex items-center gap-1.5">
            <span className="loading loading-spinner loading-xs text-primary"></span>
            {label}
          </span>
          <span className="text-xs font-mono font-semibold text-primary">{percentage}</span>
        </div>

        <div className="w-full bg-base-300 rounded-full h-2 overflow-hidden">
          <div
            className="bg-gradient-to-r from-primary to-secondary h-full rounded-full transition-all duration-300 ease-out"
            style={{ width }}
          />
        </div>
      </div>
    </div>
  );
}

