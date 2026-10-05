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
  Clock,
  PlayCircle,
  Gavel,
  Link2,
} from "lucide-react";
import Link from "next/link";
import StepTimeline from "./StepTimeline";
import toast from "react-hot-toast";

const STATUS_BADGES = {
  queued: "badge-ghost",
  running: "badge-info",
  paused_at_checkpoint: "badge-warning",
  completed: "badge-success",
  failed: "badge-error",
  cancelled: "badge-neutral",
  waiting: "badge-info badge-outline",
  paused: "badge-warning badge-outline",
};

const RUN_STATUS_LABELS = {
  waiting: "working · waiting for events",
  paused_at_checkpoint: "waiting for your approval",
};

// The hiring agent runs in the background, so the plain words matter: queued means it is about to start
const RECRUITER_STATUS_LABELS = {
  queued: "starting",
  running: "working",
  waiting: "waiting",
  paused_at_checkpoint: "waiting for you",
  paused: "paused",
};
const TONE_TEXT = { info: "text-base-content/70", warning: "text-warning", success: "text-success", error: "text-error" };

const MODE_LABELS = { assisted: "Assisted", autopilot: "Autopilot", semi_auto: "Semi-Auto", full_auto: "Full-Auto" };

// What the recruiter agent did, in plain words (agent_actions.action)
const ACTION_LABELS = {
  write_post: "Wrote job post",
  publish_post: "Publish job post",
  import_applicants: "Imported applicants",
  screen: "Queued screening",
  prepare_questions: "Prepared interview questions",
  shortlist: "Shortlist",
  hold_back: "Don't shortlist",
  send_invites: "Interview invite",
  final_decision: "Final decision",
};
const ACTION_STATUS_BADGES = {
  executed: "badge-success",
  approved: "badge-info",
  pending: "badge-warning",
  rejected: "badge-ghost",
  failed: "badge-error",
  superseded: "badge-ghost",
};

// Short progress note under a step, from its output
function stepDetail(step) {
  const o = step.output || {};
  if (o.pendingApprovals) return `${o.pendingApprovals} waiting for your approval`;
  if (o.waitingForDailyLimit) return `${o.waitingForDailyLimit} waiting for tomorrow's invite limit`;
  if (step.stepKey === "screen_candidates" && o.pending) return `${o.pending} being screened`;
  if (step.stepKey === "await_interviews" && (o.invited || o.inProgress)) return `${o.invited || 0} invited · ${o.inProgress || 0} in progress · ${o.completed || 0} done`;
  if (o.note) return o.note;
  if (o.error) return o.error;
  return null;
}

const STEP_LABELS = {
  create_job: "Create Job Posting",
  load_job: "Load job",
  generate_post: "Write job post",
  approve_post: "Approve job post",
  post_to_linkedin: "Publish to LinkedIn",
  publish_to_rozee: "Publish to Rozee.pk",
  scrape_rozee_applicants: "Import Rozee applicants",
  review_shortlist: "Shortlist",
  prepare_questions: "Prepare interview questions",
  send_interview_invites: "Send interview invites",
  await_interviews: "Interviews",
  final_decisions: "Final decisions",
  publish_job: "Publish Job",
  monitor_candidates: "Monitor Candidates",
  screen_candidates: "Screen applications",
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
  // The page refreshes its runs in the background; show what it found (status, what the agent is doing)
  useEffect(() => {
    setRun((prev) => ({ ...prev, ...initialRun }));
  }, [initialRun]);
  const [steps, setSteps] = useState([]);
  const [actions, setActions] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [loadingSteps, setLoadingSteps] = useState(false);
  const [regeneratingPost, setRegeneratingPost] = useState(false);
  const streamRef = useRef(null);

  const isActive = ["queued", "running", "waiting", "paused_at_checkpoint", "paused"].includes(run.status);
  const isRecruiter = run.pipelineType === "recruiter";

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
      } catch { /* ignore */ }
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
        setActions(data.actions || []);
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

  const handlePause = async (paused) => {
    try {
      const res = await fetch(`/api/agents/runs/${run.id}/${paused ? "pause" : "resume"}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRun((prev) => ({ ...prev, status: data.run.status }));
      toast.success(paused ? "Agent paused" : "Agent resumed");
    } catch (err) {
      toast.error(err.message || "Network error");
    }
  };

  const copyApplyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${run.activity.applyPath}`);
      toast.success("Apply link copied");
    } catch {
      toast.error("Could not copy the link");
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
  const modeLabel = MODE_LABELS[run.mode] || run.mode;

  const isRecruiterApprovePostCheckpoint =
    run.pipelineType === "recruiter" &&
    run.status === "paused_at_checkpoint" &&
    run.currentStep === "approve_post";

  const isSalesOpApproveMessagesCheckpoint =
    run.pipelineType === "sales_operator" &&
    run.status === "paused_at_checkpoint" &&
    run.currentStep === "approve_messages";

  // Prefer aggregated results from run, but fall back to step output if needed
  const salesOpGenerateMessagesOutput =
    run.results?.generate_messages ||
    steps.find((s) => s.stepKey === "generate_messages")?.output;

  // The recruiter agent keeps the post in its step output
  const generatedPost =
    run.results?.generate_post?.linkedinPost ||
    run.results?.load_job?.existingPost ||
    steps.find((s) => s.stepKey === "generate_post")?.output?.linkedinPost ||
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
          ) : run.status === "paused_at_checkpoint" || run.status === "paused" ? (
            <Pause size={18} className="text-warning" />
          ) : run.status === "waiting" ? (
            <Clock size={18} className="text-info" />
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
            {isRecruiter && run.activity && isActive && (
              <p className={`text-xs mt-0.5 ${TONE_TEXT[run.activity.tone] || TONE_TEXT.info}`}>
                <span className="font-medium">{run.activity.headline}.</span>{" "}
                <span className="text-base-content/60">{run.activity.detail}</span>
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {run.currentStep && isActive && (
            <span className="text-xs text-base-content/50 hidden sm:inline">
              {STEP_LABELS[run.currentStep] || run.currentStep}
            </span>
          )}
          {isRecruiter && isActive && run.activity?.needsYou > 0 && (
            <span className="badge badge-warning badge-sm">{run.activity.needsYou} waiting for you</span>
          )}
          <span className={`badge badge-sm ${STATUS_BADGES[run.status] || "badge-ghost"}`}>
            {(isRecruiter && RECRUITER_STATUS_LABELS[run.status]) || RUN_STATUS_LABELS[run.status] || run.status.replace(/_/g, " ")}
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
              <StepTimeline steps={steps} pipelineStepLabels={STEP_LABELS} stepDetail={isRecruiter ? stepDetail : undefined} />

              {isRecruiter && actions.length > 0 && (
                <details className="mt-4">
                  <summary className="text-sm font-semibold cursor-pointer">Activity ({actions.length})</summary>
                  <p className="text-xs text-base-content/50 mt-1">Everything the agent did or asked, and who approved it.</p>
                  <ul className="mt-2 space-y-1 max-h-72 overflow-auto">
                    {actions.map((a) => (
                      <li key={a.id} className="text-xs flex flex-wrap items-center gap-2 py-1 border-b border-base-300/60">
                        <span className={`badge badge-xs ${ACTION_STATUS_BADGES[a.status] || "badge-ghost"}`}>{a.status}</span>
                        <span className="font-medium">{ACTION_LABELS[a.action] || a.action}</span>
                        <span className="text-base-content/70 flex-1 min-w-0">{a.summary}</span>
                        <span className="text-base-content/50">
                          {a.decidedBy === "agent" ? "by the agent" : a.decidedBy ? "approved by you" : "waiting"}
                          {a.decisionNote ? ` · "${a.decisionNote}"` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

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

              {isSalesOpApproveMessagesCheckpoint && salesOpGenerateMessagesOutput && (
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
                        {salesOpGenerateMessagesOutput.totalLeads ?? "-"}
                      </span>
                    </p>
                    <p>
                      Leads with generated messages:{" "}
                      <span className="font-semibold">
                        {salesOpGenerateMessagesOutput.generated ?? "-"}
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

              <div className="flex flex-wrap gap-2 mt-4">
                {run.status === "paused_at_checkpoint" && (
                  <button className="btn btn-primary btn-sm" onClick={handleApprove}>
                    <CheckCircle2 size={14} /> Approve & Continue
                  </button>
                )}
                {/* Decisions is only offered when the agent is actually waiting for the person */}
                {isRecruiter && isActive && run.activity?.needsYou > 0 && (
                  <Link href="/dashboard/recruiter/decisions" className="btn btn-primary btn-sm">
                    <Gavel size={14} /> Review {run.activity.needsYou} request{run.activity.needsYou === 1 ? "" : "s"}
                  </Link>
                )}
                {isRecruiter && isActive && run.activity?.stuck && (
                  <Link href="/dashboard/recruiter/setup" className="btn btn-outline btn-warning btn-sm">
                    Open the setup guide
                  </Link>
                )}
                {isRecruiter && isActive && run.activity?.counts?.total === 0 && run.activity.applyPath && (
                  <button className="btn btn-outline btn-sm" onClick={copyApplyLink}>
                    <Link2 size={14} /> Copy the apply link
                  </button>
                )}
                {isRecruiter && isActive && run.status !== "paused" && (
                  <button className="btn btn-ghost btn-sm" onClick={() => handlePause(true)}>
                    <Pause size={14} /> Pause
                  </button>
                )}
                {isRecruiter && run.status === "paused" && (
                  <button className="btn btn-primary btn-sm" onClick={() => handlePause(false)}>
                    <PlayCircle size={14} /> Resume
                  </button>
                )}
                {isActive && (
                  <button className="btn btn-outline btn-error btn-sm" onClick={handleCancel}>
                    <StopCircle size={14} /> {isRecruiter ? "Stop agent" : "Cancel"}
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
