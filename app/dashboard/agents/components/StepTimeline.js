"use client";

import {
  CheckCircle2,
  Circle,
  Loader2,
  PauseCircle,
  XCircle,
  SkipForward,
  ShieldCheck,
} from "lucide-react";

const STATUS_CONFIG = {
  pending: { icon: Circle, color: "text-base-content/30", bg: "bg-base-300/30" },
  running: { icon: Loader2, color: "text-info", bg: "bg-info/10", animate: true },
  awaiting_approval: { icon: PauseCircle, color: "text-warning", bg: "bg-warning/10" },
  approved: { icon: ShieldCheck, color: "text-success", bg: "bg-success/10" },
  completed: { icon: CheckCircle2, color: "text-success", bg: "bg-success/10" },
  skipped: { icon: SkipForward, color: "text-base-content/40", bg: "bg-base-300/20" },
  failed: { icon: XCircle, color: "text-error", bg: "bg-error/10" },
};

export default function StepTimeline({ steps, pipelineStepLabels }) {
  if (!steps?.length) return null;

  return (
    <div className="space-y-1">
      {steps.map((step, i) => {
        const cfg = STATUS_CONFIG[step.status] || STATUS_CONFIG.pending;
        const Icon = cfg.icon;
        const label = pipelineStepLabels?.[step.stepKey] || step.stepKey;

        return (
          <div key={step.stepKey} className="flex items-center gap-3">
            <div className="flex flex-col items-center">
              <div className={`p-1 rounded-full ${cfg.bg}`}>
                <Icon
                  size={16}
                  className={`${cfg.color} ${cfg.animate ? "animate-spin" : ""}`}
                />
              </div>
              {i < steps.length - 1 && (
                <div className={`w-0.5 h-5 ${step.status === "completed" || step.status === "approved" ? "bg-success/40" : "bg-base-300"}`} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${cfg.color}`}>{label}</p>
              <p className="text-xs text-base-content/40 capitalize">{step.status.replace(/_/g, " ")}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
