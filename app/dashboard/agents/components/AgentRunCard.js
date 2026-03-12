"use client";

import { useState, useEffect, useRef } from "react";
import {
  Play,
  Pause,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  StopCircle,
  RefreshCw,
} from "lucide-react";
import StepTimeline from "./StepTimeline";
import toast from "react-hot-toast";

const STATUS_BADGES = {
  queued: "badge-ghost",
  running: "badge-info",
  paused_at_checkpoint: "badge-warning",
  completed: "badge-success",
  failed: "badge-error",
  cancelled: "badge-neutral",
};

const STEP_LABELS = {
  create_job: "Create Job Posting",
  generate_post: "Generate AI LinkedIn Post",
  approve_post: "Approve LinkedIn Post",
  publish_job: "Publish Job",
  monitor_candidates: "Monitor Candidates",
  screen_candidates: "AI Screen & Rank",
  notify_shortlist: "Review Shortlist",
  create_campaign: "Create Campaign",
  add_leads: "Import Leads",
  scrape_profiles: "Scrape Profiles",
  generate_messages: "Generate Messages",
  approve_messages: "Approve Messages",
  send_invites: "Send Invites",
  check_connections: "Check Connections",
  report_results: "Results Report",
};

export default function AgentRunCard({ run: initialRun, onRefresh }) {
  const [run, setRun] = useState(initialRun);
  const [steps, setSteps] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [loadingSteps, setLoadingSteps] = useState(false);
  const [regeneratingPost, setRegeneratingPost] = useState(false);
  const streamRef = useRef(null);

  const isActive = ["queued", "running", "paused_at_checkpoint"].includes(run.status);

  useEffect(() => {
    if (!isActive || !expanded) return;

    const eventSource = new EventSource(`/api/agents/runs/${run.id}/stream`);
    streamRef.current = eventSource;

    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "update") {
          setRun((prev) => ({ ...prev, ...data.run }));
          setSteps(data.steps);
        }
        if (data.type === "done") {
          setRun((prev) => ({ ...prev, status: data.finalStatus }));
          eventSource.close();
        }
      } catch {}
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => eventSource.close();
  }, [run.id, isActive, expanded]);

  const fetchSteps = async () => {
    setLoadingSteps(true);
    try {
      const res = await fetch(`/api/agents/runs/${run.id}`);
      const data = await res.json();
      if (data.success) {
        setRun(data.run);
        setSteps(data.steps);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingSteps(false);
    }
  };

  const toggleExpand = () => {
    if (!expanded && steps.length === 0) fetchSteps();
    setExpanded(!expanded);
  };

  const handleApprove = async () => {
    try {
      const res = await fetch(`/api/agents/runs/${run.id}/approve`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        toast.success("Checkpoint approved — resuming");
        setRun((prev) => ({ ...prev, status: "running" }));
      } else {
        toast.error(data.error || "Failed to approve");
      }
    } catch {
      toast.error("Network error");
    }
  };

  const handleCancel = async () => {
    try {
      const res = await fetch(`/api/agents/runs/${run.id}/cancel`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        toast.success("Run cancelled");
        setRun((prev) => ({ ...prev, status: "cancelled" }));
      }
    } catch {
      toast.error("Network error");
    }
  };

  const pipelineLabel = run.pipelineType === "recruiter" ? "Recruiter" : "Sales Operator";
  const modeLabel = run.mode === "full_auto" ? "Full-Auto" : "Semi-Auto";

  const isRecruiterApprovePostCheckpoint =
    run.pipelineType === "recruiter" &&
    run.status === "paused_at_checkpoint" &&
    run.currentStep === "approve_post";

  const isSalesOpApproveMessagesCheckpoint =
    run.pipelineType === "sales_operator" &&
    run.status === "paused_at_checkpoint" &&
    run.currentStep === "approve_messages";

  const generatedPost =
    run.results?.generate_post?.linkedinPost ||
    run.results?.load_job?.existingPost ||
    "";

  const generatedJobId =
    run.results?.generate_post?.jobId || run.results?.load_job?.jobId;

  const handleRegeneratePost = async () => {
    if (!generatedJobId) return;
    try {
      setRegeneratingPost(true);
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const applyUrl = origin ? `${origin}/apply/${generatedJobId}` : "";
      const res = await fetch(`/api/hiring/jobs/${generatedJobId}/generate-post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tone: "professional", applyUrl }),
      });
      const data = await res.json();
      if (!res.ok || !data.linkedinPost) {
        throw new Error(data.error || "Failed to regenerate post");
      }

      toast.success("LinkedIn post regenerated");
      setRun((prev) => ({
        ...prev,
        results: {
          ...(prev.results || {}),
          generate_post: {
            ...(prev.results?.generate_post || {}),
            jobId: generatedJobId,
            linkedinPost: data.linkedinPost,
            applyUrl,
          },
        },
      }));
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Failed to regenerate post");
    } finally {
      setRegeneratingPost(false);
    }
  };

  return (
    <div className="bg-base-100 border border-base-300 rounded-xl overflow-hidden">
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-base-200/40 transition-colors"
        onClick={toggleExpand}
      >
        <div className="flex items-center gap-3">
          {run.status === "running" ? (
            <Loader2 size={18} className="text-info animate-spin" />
          ) : run.status === "paused_at_checkpoint" ? (
            <Pause size={18} className="text-warning" />
          ) : run.status === "completed" ? (
            <CheckCircle2 size={18} className="text-success" />
          ) : run.status === "failed" ? (
            <XCircle size={18} className="text-error" />
          ) : (
            <Play size={18} className="text-base-content/40" />
          )}

          <div>
            <p className="font-semibold text-sm">{pipelineLabel} Agent</p>
            <p className="text-xs text-base-content/50">
              {modeLabel} &middot; {new Date(run.createdAt).toLocaleString()}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {run.currentStep && isActive && (
            <span className="text-xs text-base-content/50 hidden sm:inline">
              {STEP_LABELS[run.currentStep] || run.currentStep}
            </span>
          )}
          <span className={`badge badge-sm ${STATUS_BADGES[run.status] || "badge-ghost"}`}>
            {run.status.replace(/_/g, " ")}
          </span>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-base-300 p-4 bg-base-200/20">
          {loadingSteps ? (
            <div className="flex justify-center py-4">
              <Loader2 className="animate-spin text-primary" size={20} />
            </div>
          ) : (
            <>
              <StepTimeline steps={steps} pipelineStepLabels={STEP_LABELS} />

              {isRecruiterApprovePostCheckpoint && generatedPost && (
                <div className="mt-4 p-4 rounded-xl bg-base-200 border border-base-300 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-base-content">
                        Generated LinkedIn Post
                      </p>
                      <p className="text-xs text-base-content/60">
                        Review and optionally regenerate before approving.
                      </p>
                    </div>
                    <button
                      className="btn btn-ghost btn-xs gap-1"
                      onClick={handleRegeneratePost}
                      disabled={regeneratingPost}
                    >
                      {regeneratingPost ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <RefreshCw size={12} />
                      )}
                      Regenerate
                    </button>
                  </div>
                  <div className="textarea textarea-bordered w-full min-h-[160px] whitespace-pre-wrap text-sm bg-base-100">
                    {generatedPost}
                  </div>
                </div>
              )}

              {isSalesOpApproveMessagesCheckpoint && run.results?.generate_messages && (
                <div className="mt-4 p-4 rounded-xl bg-base-200 border border-base-300 space-y-2">
                  <p className="text-sm font-semibold text-base-content">
                    Generated personalized messages
                  </p>
                  <p className="text-xs text-base-content/70">
                    Messages have been generated for campaign leads. Review or regenerate per-lead
                    in the campaign&apos;s AI Message panel before approving.
                  </p>
                  <div className="text-xs text-base-content/80 space-y-1">
                    <p>
                      Total leads in campaign:{" "}
                      <span className="font-semibold">
                        {run.results.generate_messages.totalLeads ?? "-"}
                      </span>
                    </p>
                    <p>
                      Leads with generated messages:{" "}
                      <span className="font-semibold">
                        {run.results.generate_messages.generated ?? "-"}
                      </span>
                    </p>
                  </div>
                </div>
              )}

              {run.errorMessage && (
                <div className="mt-3 p-3 rounded-lg bg-error/10 text-error text-sm">
                  {run.errorMessage}
                </div>
              )}

              <div className="flex gap-2 mt-4">
                {run.status === "paused_at_checkpoint" && (
                  <button className="btn btn-primary btn-sm" onClick={handleApprove}>
                    <CheckCircle2 size={14} /> Approve & Continue
                  </button>
                )}
                {isActive && (
                  <button className="btn btn-outline btn-error btn-sm" onClick={handleCancel}>
                    <StopCircle size={14} /> Cancel
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={fetchSteps}>
                  <RotateCcw size={14} /> Refresh
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
