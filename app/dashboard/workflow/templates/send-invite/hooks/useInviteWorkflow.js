import { useState, useEffect, useRef, useCallback } from "react";

const initialProgress = { current: 0, total: 0, stage: null };
const CONTROLLABLE_STATUSES = ["processing", "paused", "queued"];

export default function useInviteWorkflow({ campaignId }) {
  const [isRunning, setIsRunning] = useState(false);
  const [activationStatus, setActivationStatus] = useState(null);
  const [progress, setProgress] = useState(initialProgress);
  const [isProcessing, setIsProcessing] = useState(false);
  const [preflightStage, setPreflightStage] = useState(null);
  const [currentJobId, setCurrentJobId] = useState(null);
  const [status, setStatus] = useState(null);
  const eventSourceRef = useRef(null);

  const resetProgress = () => setProgress(initialProgress);

  const handleRunWorkflowBackground = useCallback(async () => {
    if (!campaignId) {
      setActivationStatus({
        type: "error",
        message: "Campaign ID is required to run workflow",
      });
      return;
    }

    localStorage.removeItem("currentJobId");
    localStorage.removeItem("currentCampaignId");

    setIsRunning(true);
    setActivationStatus(null);
    setProgress({ current: 0, total: 1, stage: null });
    setIsProcessing(true);
    
    // ✅ Set preflight stage immediately for instant feedback
    setPreflightStage('validating_campaign');
    console.log('🚀 Starting workflow - setting preflight stage');

    try {
      // ✅ OPTIMISTIC: Show progress during API call
      const updatePreflightStage = (stage) => {
        console.log(`📊 Preflight stage: ${stage}`);
        setPreflightStage(stage);
        setProgress(prev => ({ ...prev, stage }));
      };

      // Start workflow API call
      // While the API processes, we'll show optimistic stages
      const fetchPromise = fetch(`/api/campaigns/${campaignId}/start-workflow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customMessage: "Hi! I'd like to connect with you.",
        }),
      });

      // Show optimistic stages while API call is in progress
      // These stages represent what the API is doing internally
      const stages = ['finding_account', 'checking_existing', 'creating_job', 'spawning_worker'];
      let stageIndex = 0;
      
      const stageInterval = setInterval(() => {
        if (stageIndex < stages.length) {
          updatePreflightStage(stages[stageIndex]);
          stageIndex++;
        } else {
          clearInterval(stageInterval);
        }
      }, 200); // Update every 200ms for smooth progression

      // Wait for API response
      const response = await fetchPromise;
      
      // Clear interval once we get response
      clearInterval(stageInterval);
      
      // Show final preflight stage
      updatePreflightStage('spawning_worker');

      if (!response.ok) {
        const errorData = await response.json();

        if (response.status === 409 && errorData.jobId) {
          if (errorData.isSameCampaign) {
            setCurrentJobId(errorData.jobId);
            localStorage.setItem("currentJobId", errorData.jobId);
            localStorage.setItem("currentCampaignId", campaignId);
            setProgress({
              current: errorData.processedLeads || 0,
              total: errorData.totalLeads || 0,
              stage: null,
            });
            setActivationStatus({
              type: "info",
              message: "🔄 Workflow already running",
              details: `Resuming existing workflow (${errorData.progress || 0}% complete). Progress: ${errorData.processedLeads || 0}/${errorData.totalLeads || 0}`,
            });
            return;
          }

          setActivationStatus({
            type: "warning",
            message: "⚠️ Another workflow is running",
            details: `Workflow for campaign "${errorData.campaignName || "Unknown"}" is currently running (${errorData.progress || 0}% complete). Please wait for it to finish before starting a new one.`,
          });
          setIsRunning(false);
          setIsProcessing(false);
          return;
        }

        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      const { jobId, message } = await response.json();
      
      // Step 6: Connecting to stream
      updatePreflightStage('connecting_stream');
      
      setCurrentJobId(jobId);
      localStorage.setItem("currentJobId", jobId);
      localStorage.setItem("currentCampaignId", campaignId);

      setActivationStatus({
        type: "info",
        message: message || "Workflow started in background",
        details: "You can close this page. The workflow will continue running on the server.",
      });
    } catch (error) {
      console.error("❌ Start workflow error:", error);
      setActivationStatus({
        type: "error",
        message: "Failed to start workflow",
        details: error.message,
      });
      setIsRunning(false);
      setIsProcessing(false);
      setPreflightStage(null);
    }
  }, [campaignId]);

  const handlePauseWorkflow = useCallback(async () => {
    if (!currentJobId) return;
    try {
      const response = await fetch(`/api/jobs/${currentJobId}/pause`, { method: "POST" });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to pause");
      }
      setActivationStatus({
        type: "info",
        message: "⏸️ Workflow pausing...",
        details: "The workflow will pause after the current batch completes.",
      });
    } catch (error) {
      console.error("❌ Pause error:", error);
      setActivationStatus({
        type: "error",
        message: "Failed to pause workflow",
        details: error.message,
      });
    }
  }, [currentJobId]);

  const handleResumeWorkflow = useCallback(async () => {
    if (!currentJobId) return;
    try {
      const response = await fetch(`/api/jobs/${currentJobId}/resume`, { method: "POST" });
      if (!response.ok) {
        const errorData = await response.json();
        if (response.status === 409) {
          setActivationStatus({
            type: "warning",
            message: "⚠️ Another workflow is running",
            details: errorData.message,
          });
          return;
        }
        throw new Error(errorData.error || "Failed to resume");
      }
      setActivationStatus({
        type: "info",
        message: "▶️ Workflow resumed",
        details: "Continuing from where you left off...",
      });
      setIsRunning(true);
      setIsProcessing(true);
    } catch (error) {
      console.error("❌ Resume error:", error);
      setActivationStatus({
        type: "error",
        message: "Failed to resume workflow",
        details: error.message,
      });
    }
  }, [currentJobId]);

  const handleCancelWorkflow = useCallback(async () => {
    if (!currentJobId) return;
    const confirmCancel = window.confirm(
      "Are you sure? This will permanently cancel the workflow and you cannot resume it."
    );
    if (!confirmCancel) return;

    try {
      const response = await fetch(`/api/jobs/${currentJobId}/cancel`, { method: "POST" });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to cancel");
      }

      setActivationStatus({
        type: "warning",
        message: "🛑 Workflow cancelled",
        details: "You can start a new workflow.",
      });

      setIsRunning(false);
      setIsProcessing(false);
      setCurrentJobId(null);
      resetProgress();
      localStorage.removeItem("currentJobId");
      localStorage.removeItem("currentCampaignId");
    } catch (error) {
      console.error("❌ Cancel error:", error);
      setActivationStatus({
        type: "error",
        message: "Failed to cancel workflow",
        details: error.message,
      });
    }
  }, [currentJobId]);

  const handleRunWorkflow = useCallback(async () => {
    if (!campaignId) {
      setActivationStatus({
        type: "error",
        message: "Campaign ID is required to run workflow",
      });
      return;
    }

    setIsRunning(true);
    setActivationStatus(null);
    resetProgress();
    setIsProcessing(true);

    try {
      const response = await fetch(`/api/redis-workflow/campaigns/${campaignId}/activate-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customMessage: "Hi there! I'd like to connect with you.",
          batchSize: 10,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Streaming not supported in this environment.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let reading = true;

      while (reading) {
        const { done, value } = await reader.read();
        if (done) {
          reading = false;
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonData = line.slice(6);

          try {
            const data = JSON.parse(jsonData);
            if (data.type === "start") {
              setProgress({ current: 0, total: data.total, stage: null });
            } else if (data.type === "progress") {
              setProgress({ current: data.current, total: data.total, stage: null });
            } else if (data.type === "batch_delay") {
              setActivationStatus({
                type: "info",
                message: `Waiting ${data.delayMinutes} minutes before next batch (${data.nextBatch}/${data.totalBatches})...`,
              });
            } else if (data.type === "limit_reached") {
              setActivationStatus({
                type: "warning",
                message: data.message,
                details: `${data.remaining} batches remaining. Resume tomorrow.`,
              });
            } else if (data.type === "complete") {
              setProgress({ current: data.total, total: data.total, stage: null });
              setActivationStatus({
                type: "success",
                message: "Workflow completed!",
                details: `Sent: ${data.sent}, Already Connected: ${data.alreadyConnected}, Already Pending: ${data.alreadyPending}, Failed: ${data.failed}`,
              });
              setIsProcessing(false);
            } else if (data.type === "error") {
              setActivationStatus({
                type: "error",
                message: data.message,
                details: data.details,
              });
              setIsProcessing(false);
            }
          } catch (parseError) {
            console.error("❌ Failed to parse SSE JSON:", parseError);
          }
        }
      }
    } catch (error) {
      console.error("❌ SSE Error:", error);
      setActivationStatus({
        type: "error",
        message: "Network error occurred while activating workflow",
        details: error.message,
      });
      setIsProcessing(false);
    } finally {
      setIsRunning(false);
    }
  }, [campaignId]);

  useEffect(() => {
    if (!currentJobId) {
      return undefined;
    }

    const eventSource = new EventSource(`/api/jobs/${currentJobId}/stream`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "connected") {
          // ✅ Clear preflight stage once SSE is connected
          setPreflightStage(null);
          return;
        }
        if (data.type !== "status") return;

        // ✅ Clear preflight stage once we receive real SSE data
        setPreflightStage(null);

        const currentProgress =
          data.fractionalProgress !== undefined
            ? data.fractionalProgress
            : data.currentLead || data.processedLeads || 0;

        setStatus(data);
        setProgress({
          current: currentProgress,
          total: data.totalLeads || 0,
          stage: data.stage || null,
        });

        if (data.status === "completed") {
          setIsRunning(false);
          setIsProcessing(false);
          if (data.results?.skipped) {
            setActivationStatus({
              type: "info",
              message: "✅ Workflow completed - Nothing to do",
              details: data.results.message || "All leads in this campaign have already been processed.",
            });
          } else {
            setActivationStatus({
              type: "success",
              message: "✅ Workflow completed!",
              details: data.results
                ? `Sent: ${data.results.sent}, Already Connected: ${data.results.alreadyConnected}, Already Pending: ${data.results.alreadyPending}, Failed: ${data.results.failed}`
                : "Workflow completed successfully",
            });
          }
          localStorage.removeItem("currentJobId");
          localStorage.removeItem("currentCampaignId");
        } else if (data.status === "paused") {
          setIsRunning(false);
          setIsProcessing(false);
          setActivationStatus({
            type: "info",
            message: "⏸️ Workflow paused",
            details: "Click Resume to continue where you left off.",
          });
        } else if (data.status === "cancelled") {
          setIsRunning(false);
          setIsProcessing(false);
          setCurrentJobId(null);
          resetProgress();
          setActivationStatus({
            type: "warning",
            message: "🛑 Workflow cancelled",
            details: "Workflow was cancelled by user.",
          });
          localStorage.removeItem("currentJobId");
          localStorage.removeItem("currentCampaignId");
        } else if (data.status === "failed" || data.status === "timeout") {
          setIsRunning(false);
          setIsProcessing(false);
          const isTimeout = data.status === "timeout";
          setActivationStatus({
            type: "error",
            message: isTimeout ? "⏱️ Workflow timed out" : "❌ Workflow failed",
            details:
              data.errorMessage ||
              (isTimeout
                ? "The workflow took too long and may have crashed. Please try again."
                : "An error occurred during workflow execution."),
          });
          localStorage.removeItem("currentJobId");
          localStorage.removeItem("currentCampaignId");
        } else if (data.status === "processing" || data.status === "queued") {
          setIsRunning(true);
          setIsProcessing(true);
        }
      } catch (error) {
        console.error("❌ Failed to parse SSE data:", error);
      }
    };

    eventSource.onerror = (err) => {
      console.error("❌ SSE connection error:", err);
    };

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [currentJobId]);

  useEffect(() => {
    const checkForActiveJob = async () => {
      if (!campaignId) return;

      try {
        const response = await fetch(`/api/campaigns/${campaignId}/active-job`);
        if (!response.ok) return;

        const { job } = await response.json();
        if (job && CONTROLLABLE_STATUSES.includes(job.status)) {
          setCurrentJobId(job.id);
          setIsRunning(job.status !== "paused");
          setIsProcessing(job.status === "processing");
          setProgress({
            current: job.processedLeads || 0,
            total: job.totalLeads || 0,
            stage: null,
          });
          setStatus({
            type: "status",
            jobId: job.id,
            campaignId: job.campaignId,
            status: job.status,
            progress: job.progress || 0,
            totalLeads: job.totalLeads,
            processedLeads: job.processedLeads || 0,
            results: job.results,
            errorMessage: job.errorMessage,
            createdAt: job.createdAt,
            startedAt: job.startedAt,
            completedAt: job.completedAt,
            pausedAt: job.pausedAt,
          });
          localStorage.setItem("currentJobId", job.id);
          localStorage.setItem("currentCampaignId", campaignId);
        }
      } catch (error) {
        console.error("❌ Error checking for active job:", error);
      }
    };

    checkForActiveJob();
  }, [campaignId]);

  return {
    state: {
      isRunning,
      activationStatus,
      progress,
      isProcessing,
      preflightStage,
      status,
      currentJobId,
    },
    actions: {
      handleRunWorkflowBackground,
      handleRunWorkflow,
      handlePauseWorkflow,
      handleResumeWorkflow,
      handleCancelWorkflow,
    },
  };
}

