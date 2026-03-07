"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Minus, Maximize2, Save, Target, Undo2, Trash2, Play, Pause, X, AlertCircle } from "lucide-react";
import ReactFlow, { Background, Controls, MiniMap, addEdge, useEdgesState, useNodesState, MarkerType, BaseEdge, getBezierPath, Handle, Position, EdgeLabelRenderer } from "reactflow";
import "reactflow/dist/style.css";

const edgeStyle = { stroke: "#3b475e", strokeWidth: 5 };

function DelayEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style = edgeStyle, data }) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const pill = data?.pill || "";
  const caption = data?.caption || "";
  const captionColor = data?.captionColor || "#94a3b8";
  const dashed = data?.dashed;
  const captionOnTop = data?.captionOnTop;
  return (
    <g>
      <BaseEdge id={id} path={path} style={{ ...style, strokeDasharray: dashed ? "4 4" : undefined }} />
      <EdgeLabelRenderer>
        <div style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: 'none', zIndex: 1000 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {captionOnTop && caption && (
              <div style={{ marginBottom: 6, color: captionColor, fontSize: 9, textAlign: 'center', whiteSpace: 'nowrap' }}>{caption}</div>
            )}
            {pill && (
              <div style={{ background: '#F87941', color: '#fff', borderRadius: 9999, fontSize: 9, padding: '6px 13px', lineHeight: 1, boxShadow: '0 0 0 2px rgba(15,23,42,0.15)', whiteSpace: 'nowrap' }}>{pill}</div>
            )}
            {!captionOnTop && caption && (
              <div style={{ marginTop: 6, color: captionColor, fontSize: 9, textAlign: 'center', whiteSpace: 'nowrap' }}>{caption}</div>
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
    </g>
  );
}

const nodeWrapperStyle = { boxShadow: 'none', background: 'transparent', border: 'none', padding: 0 };

const initialNodes = [
  { id: "start", position: { x: 250, y: 100 }, data: { label: "Start", icon: "🛈" }, type: "default", style: nodeWrapperStyle },
  { id: "invite", position: { x: 250, y: 300 }, data: { label: "Send invite", icon: "✉" }, style: nodeWrapperStyle },
  { id: "end", position: { x: 250, y: 500 }, data: { label: "End of sequence", isEnd: true, icon: "■" }, style: nodeWrapperStyle },
];

const initialEdges = [
  { id: "e-start-invite", source: "start", target: "invite", type: "delay", data: { pill: "Immediately" }, style: edgeStyle, markerEnd: { type: MarkerType.ArrowClosed, color: "#3b475e" } },
  { id: "e-invite-end", source: "invite", target: "end", type: "delay", data: { pill: "No delay" }, style: edgeStyle, markerEnd: { type: MarkerType.ArrowClosed, color: "#3b475e" } },
];

function DarkNode({ data, id }) {
  const isEnd = data?.isEnd;
  const [showDelete, setShowDelete] = useState(false);
  
  const handleDelete = (e) => {
    e.stopPropagation();
    const event = new CustomEvent('deleteNode', { detail: { nodeId: id } });
    window.dispatchEvent(event);
  };

  return (
    <div 
      className="relative min-w-[250px] group"
      onMouseEnter={() => setShowDelete(true)}
      onMouseLeave={() => setShowDelete(false)}
    >
      <div className={`relative rounded-xl border ${isEnd ? "border-[#2b3447] bg-[#2a3446]" : "border-[#2b3447] bg-[#1c2434]"} px-5 py-4 shadow-none`} style={{ boxShadow: "none" }}>
        <div className="text-[12px] text-[#dbe4f3] font-medium flex items-center gap-3">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[#2f3a4e] text-[#c7d2fe] text-sm">{data?.icon || "◎"}</span>
          <span>{data?.label}</span>
        </div>
        {isEnd && (
          <div className="text-[9px] text-[#9aa6bd] mt-2">Withdraw requests if not accepted yet</div>
        )}
        
        {/* Delete button */}
        {showDelete && (
          <button
            onClick={handleDelete}
            className="absolute top-1/2 right-2 -translate-y-1/2 bg-red-500 hover:bg-red-600 text-white rounded-full p-1.5 shadow-lg transition-all duration-200 z-10"
            title="Delete node"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
      <Handle type="target" position={Position.Top} style={{ width: 7, height: 7, background: "#64748b", borderRadius: 9999 }} />
      <Handle type="source" position={Position.Bottom} style={{ width: 7, height: 7, background: "#64748b", borderRadius: 9999 }} />
    </div>
  );
}

const nodeTypes = { default: DarkNode };
const edgeTypes = { delay: DelayEdge };

export default function SendInviteCanvas({ campaignName, campaignId }) {
  const router = useRouter();
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const rf = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [isDark, setIsDark] = useState(true);
  const containerRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Workflow state
  const [isRunning, setIsRunning] = useState(false);
  const [activationStatus, setActivationStatus] = useState(null);
  
  // Progress state for SSE
  const [progress, setProgress] = useState({ current: 0, total: 0, stage: null });
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Pre-flight stages (before SSE connects)
  const [preflightStage, setPreflightStage] = useState(null);
  
  // Stage descriptions for user-friendly display
  const stageDescriptions = {
    'validating_campaign': 'Validating campaign...',
    'finding_account': 'Finding LinkedIn account...',
    'checking_existing': 'Checking for existing jobs...',
    'creating_job': 'Creating workflow job...',
    'spawning_worker': 'Starting background worker...',
    'connecting_stream': 'Connecting to live updates...',
    'starting': 'Starting to process lead...',
    'navigating': 'Visiting profile...',
    'checking': 'Checking connection status...',
    'finding_button': 'Finding Connect button...',
    'clicking': 'Clicking Connect button...',
    'waiting_modal': 'Waiting for modal...',
    'sending': 'Sending invitation...',
    'completed': 'Invites processed!',
    'completed_sent': 'Invites sent successfully!',
    'completed_pending': 'Invites already pending',
    'completed_connected': 'Already connected with this lead',
    'completed_none': 'No invites needed',
    'already_processed': 'Lead already processed',
    'already_pending': 'Invite already pending',
    'already_connected': 'Already connected',
    'failed': 'Failed to process',
    'processing': 'Processing...'
  };
  
  const getStageDescription = (stage) => {
    if (!stage) return 'Processing...';
    const desc = stageDescriptions[stage] || `Processing: ${stage}`;
    console.log(`📝 Stage description for "${stage}":`, desc);
    return desc;
  };
  
  const getCompletionStage = (results) => {
    if (results?.skipped) return 'already_processed';
    const sent = results?.sent || 0;
    const alreadyPending = results?.alreadyPending || 0;
    const alreadyConnected = results?.alreadyConnected || 0;
    const failed = results?.failed || 0;
    
    if (sent > 0 && alreadyPending === 0 && alreadyConnected === 0 && failed === 0) {
      return 'completed_sent';
    }
    if (alreadyPending > 0) {
      return 'completed_pending';
    }
    if (alreadyConnected > 0) {
      return 'completed_connected';
    }
    if (sent === 0) {
      return 'completed_none';
    }
    return 'completed';
  };
  
  // Background mode state
  const [currentJobId, setCurrentJobId] = useState(null);
  const [status, setStatus] = useState(null);
  const eventSourceRef = useRef(null);
  const completionTimeoutRef = useRef(null);

  const onInit = useCallback((instance) => {
    rf.current = instance;
    instance.fitView({ padding: 0.2 });
  }, []);

  const onConnect = useCallback((connection) => setEdges((eds) => addEdge({ ...connection, type: "smoothstep", style: edgeStyle, markerEnd: { type: MarkerType.ArrowClosed, color: "#596780" } }, eds)), [setEdges]);

  const zoomIn = () => rf.current?.zoomIn?.({ duration: 100 });
  const zoomOut = () => rf.current?.zoomOut?.({ duration: 100 });
  const fit = () => rf.current?.fitView?.({ padding: 0.2 });

  const deleteNode = useCallback((nodeId) => {
    setNodes((nds) => nds.filter((node) => node.id !== nodeId));
    setEdges((eds) => eds.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
  }, [setNodes, setEdges]);

  // Background workflow with polling
  const handleRunWorkflowBackground = async () => {
    if (!campaignId) {
      setActivationStatus({
        type: 'error',
        message: 'Campaign ID is required to run workflow'
      });
      return;
    }

    // Clear any old job data before starting new workflow
    localStorage.removeItem('currentJobId');
    localStorage.removeItem('currentCampaignId');

    // ✅ Set states synchronously for immediate UI update
    setIsRunning(true);
    setActivationStatus(null);
    setProgress({ current: 0, total: 1, stage: null });
    setIsProcessing(true);
    setPreflightStage('validating_campaign'); // Set immediately for instant feedback
    
    console.log('🚀 Starting workflow - isProcessing:', true, 'preflightStage: validating_campaign');

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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customMessage: "Hi! I'd like to connect with you."
        })
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
        
        // Handle existing workflow case (409 Conflict)
        if (response.status === 409 && errorData.jobId) {
          console.log(`🔄 Found existing running job: ${errorData.jobId}`);
          
          // Check if it's for the same campaign or a different one
          if (errorData.isSameCampaign) {
            // Same campaign - resume polling
            setCurrentJobId(errorData.jobId);
            localStorage.setItem('currentJobId', errorData.jobId);
            localStorage.setItem('currentCampaignId', campaignId);
            
            setProgress({ 
              current: errorData.processedLeads || 0, 
              total: errorData.totalLeads || 0 
            });
            
            setActivationStatus({ 
              type: 'info', 
              message: '🔄 Workflow already running',
              details: `Resuming existing workflow (${errorData.progress || 0}% complete). Progress: ${errorData.processedLeads || 0}/${errorData.totalLeads || 0}`
            });
            
            // Set job ID - SSE will automatically connect
            setCurrentJobId(errorData.jobId);
            return;
          } else {
            // Different campaign - show error and don't proceed
            setActivationStatus({ 
              type: 'warning', 
              message: '⚠️ Another workflow is running',
              details: `Workflow for campaign "${errorData.campaignName || 'Unknown'}" is currently running (${errorData.progress || 0}% complete). Please wait for it to finish before starting a new one.`
            });
            
            setIsRunning(false);
            setIsProcessing(false);
            return;
          }
        }
        
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      const { jobId, message, campaignName: cName } = await response.json();
      
      // Step 6: Connecting to stream
      updatePreflightStage('connecting_stream');
      
      setCurrentJobId(jobId);
      
      // Save to localStorage so we can resume if user navigates away
      localStorage.setItem('currentJobId', jobId);
      localStorage.setItem('currentCampaignId', campaignId);
      
      setActivationStatus({ 
        type: 'info', 
        message: message || 'Workflow started in background',
        details: 'You can close this page. The workflow will continue running on the server.'
      });

      console.log(`✅ Workflow started: Job ${jobId}`);

      // Clear preflight stage once SSE connects (handled in SSE useEffect)
      // SSE will automatically connect when currentJobId is set

    } catch (error) {
      console.error('❌ Start workflow error:', error);
      setActivationStatus({ 
        type: 'error', 
        message: 'Failed to start workflow', 
        details: error.message 
      });
      setIsRunning(false);
      setIsProcessing(false);
      setPreflightStage(null);
    }
  };

  // SSE connection for real-time job status updates
  useEffect(() => {
    if (!currentJobId) {
      // Close existing connection if job ID is cleared
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      return;
    }

    console.log(`📡 Connecting to SSE stream for job: ${currentJobId.substring(0, 8)}...`);

    // Create EventSource connection
    const eventSource = new EventSource(`/api/jobs/${currentJobId}/stream`);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('✅ SSE connection opened');
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'connected') {
          console.log('✅ SSE connected to job stream');
          // Clear preflight stage once SSE is connected
          setPreflightStage(null);
          return;
        }

        if (data.type === 'status') {
          // ✅ Clear preflight stage once we receive real SSE data
          setPreflightStage(null);
          
          if (completionTimeoutRef.current && data.status !== 'completed') {
            clearTimeout(completionTimeoutRef.current);
            completionTimeoutRef.current = null;
          }
          
          // Handle completion first to ensure 100% progress
          if (data.status === 'completed') {
            // ✅ Ensure progress reaches 100% - use totalLeads for both current and total
            const totalLeads = data.totalLeads || data.processedLeads || progress.total || 1;
            const finalProgress = totalLeads; // Always 100% when completed
            const completionStage = getCompletionStage(data.results);
            
            console.log(`✅ Workflow completed: ${finalProgress}/${totalLeads} (100%)`);
            
            // Update progress to 100%
            setProgress({ 
              current: finalProgress, 
              total: totalLeads,
              stage: completionStage
            });
            
            // Update status
            setStatus(data);
            
            setIsRunning(false);
            
            // Check if it was skipped
            if (data.results?.skipped) {
              setActivationStatus({
                type: 'info',
                message: '✅ Workflow completed - Nothing to do',
                details: data.results.message || 'All leads in this campaign have already been processed.'
              });
            } else {
              setActivationStatus({
                type: 'success',
                message: '✅ Workflow completed!',
                details: data.results ? 
                  `Sent: ${data.results.sent}, Already Connected: ${data.results.alreadyConnected}, Already Pending: ${data.results.alreadyPending}, Failed: ${data.results.failed}` : 
                  'Workflow completed successfully'
              });
            }
            
            // Clear localStorage
            localStorage.removeItem('currentJobId');
            localStorage.removeItem('currentCampaignId');
            
            // ✅ Keep progress bar visible for 2 seconds then reset UI
            if (completionTimeoutRef.current) {
              clearTimeout(completionTimeoutRef.current);
            }
            completionTimeoutRef.current = setTimeout(() => {
              setIsProcessing(false);
              setProgress({ current: 0, total: 0, stage: null });
              setStatus(null);
              setCurrentJobId(null);
              setActivationStatus(null);
            }, 2000);
            
            return; // Exit early for completed status
          }
          
          // For non-completed statuses, use normal progress calculation
          // Use fractionalProgress for smooth progress bar, fallback to currentLead or processedLeads
          const currentProgress = data.fractionalProgress !== undefined 
            ? data.fractionalProgress 
            : (data.currentLead || data.processedLeads || 0);
          const stageInfo = data.stage ? ` (${data.stage})` : '';
          
          console.log(`📊 Job status update: ${data.status} - ${Math.ceil(currentProgress)}/${data.totalLeads} (${data.progress}%)${stageInfo}`);
          
          // Update status
          setStatus(data);
          
          // Update progress with fractional progress and current stage for smoother bar movement
          setProgress({ 
            current: currentProgress, 
            total: data.totalLeads || 0,
            stage: data.stage || null
          });
          
          // Handle different job statuses (non-completed)
          if (data.status === 'paused') {
            setIsRunning(false);
            setIsProcessing(false);
            setProgress({
              current: 0,
              total: data.totalLeads || 0,
              stage: null
            });
            
            setActivationStatus({
              type: 'info',
              message: '⏸️ Workflow paused',
              details: 'Click Resume to continue where you left off.'
            });
            
          } else if (data.status === 'cancelled') {
            setIsRunning(false);
            setIsProcessing(false);
            
            setActivationStatus({
              type: 'warning',
              message: '🛑 Workflow cancelled',
              details: 'Workflow was cancelled by user.'
            });
            
            // Reset state
            setCurrentJobId(null);
            setProgress({ current: 0, total: 0, stage: null });
            
            // Clear localStorage
            localStorage.removeItem('currentJobId');
            localStorage.removeItem('currentCampaignId');
            
          } else if (data.status === 'failed' || data.status === 'timeout') {
            setIsRunning(false);
            setIsProcessing(false);
            
            const isTimeout = data.status === 'timeout';
            
            setActivationStatus({ 
              type: 'error', 
              message: isTimeout ? '⏱️ Workflow timed out' : '❌ Workflow failed', 
              details: data.errorMessage || (isTimeout ? 'The workflow took too long and may have crashed. Please try again.' : 'An error occurred during workflow execution.')
            });
            
            // Clear localStorage
            localStorage.removeItem('currentJobId');
            localStorage.removeItem('currentCampaignId');
            
          } else if (data.status === 'processing' || data.status === 'queued') {
            setIsRunning(true);
            setIsProcessing(true);
          }
        }

        if (data.type === 'complete') {
          console.log('✅ SSE stream completed');
          eventSource.close();
        }

        if (data.type === 'error') {
          console.error('❌ SSE error:', data.message);
          setActivationStatus({
            type: 'error',
            message: 'Connection error',
            details: data.message
          });
          eventSource.close();
        }

      } catch (error) {
        console.error('❌ Failed to parse SSE data:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('❌ SSE connection error:', error);
      // EventSource will automatically reconnect, so we don't need to handle it
    };

    // Cleanup on unmount or job ID change
    return () => {
      if (eventSourceRef.current) {
        console.log('🧹 Closing SSE connection');
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current);
        completionTimeoutRef.current = null;
      }
    };
  }, [currentJobId]);

  // Pause workflow
  const handlePauseWorkflow = async () => {
    if (!currentJobId) return;
    
    try {
      const response = await fetch(`/api/jobs/${currentJobId}/pause`, {
        method: 'POST'
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to pause');
      }
      
      setActivationStatus({
        type: 'info',
        message: '⏸️ Workflow pausing...',
        details: 'The workflow will pause after the current batch completes.'
      });
    } catch (error) {
      console.error('❌ Pause error:', error);
      setActivationStatus({
        type: 'error',
        message: 'Failed to pause workflow',
        details: error.message
      });
    }
  };

  // Resume workflow
  const handleResumeWorkflow = async () => {
    if (!currentJobId) return;
    
    try {
      const response = await fetch(`/api/jobs/${currentJobId}/resume`, {
        method: 'POST'
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        
        // Handle concurrent workflow case
        if (response.status === 409) {
          setActivationStatus({
            type: 'warning',
            message: '⚠️ Another workflow is running',
            details: errorData.message
          });
          return;
        }
        
        throw new Error(errorData.error || 'Failed to resume');
      }
      
      setActivationStatus({
        type: 'info',
        message: '▶️ Workflow resumed',
        details: 'Continuing from where you left off...'
      });
      
      // Set processing state
      setIsRunning(true);
      setIsProcessing(true);
      
      // SSE will automatically connect when currentJobId is set
      
    } catch (error) {
      console.error('❌ Resume error:', error);
      setActivationStatus({
        type: 'error',
        message: 'Failed to resume workflow',
        details: error.message
      });
    }
  };

  // Cancel workflow
  const handleCancelWorkflow = async () => {
    if (!currentJobId) return;
    
    const confirmCancel = window.confirm(
      'Are you sure? This will permanently cancel the workflow and you cannot resume it.'
    );
    
    if (!confirmCancel) return;
    
    try {
      const response = await fetch(`/api/jobs/${currentJobId}/cancel`, {
        method: 'POST'
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to cancel');
      }
      
      setActivationStatus({
        type: 'warning',
        message: '🛑 Workflow cancelled',
        details: 'You can start a new workflow.'
      });
      
      // Reset all state
      setIsRunning(false);
      setIsProcessing(false);
      setCurrentJobId(null);
      setProgress({ current: 0, total: 0, stage: null });
      
      // Clear localStorage
      localStorage.removeItem('currentJobId');
      localStorage.removeItem('currentCampaignId');
      
      // SSE will automatically close when currentJobId is null
    } catch (error) {
      console.error('❌ Cancel error:', error);
      setActivationStatus({
        type: 'error',
        message: 'Failed to cancel workflow',
        details: error.message
      });
    }
  };

  // Run Workflow function - uses SSE for real-time progress
  const handleRunWorkflow = async () => {
    if (!campaignId) {
      setActivationStatus({
        type: 'error',
        message: 'Campaign ID is required to run workflow'
      });
      return;
    }

    setIsRunning(true);
    setActivationStatus(null);
    setProgress({ current: 0, total: 0, stage: null });
    setIsProcessing(true);

    console.log(`🚀 Starting SSE workflow for campaign: ${campaignId}`);

    try {
      const response = await fetch(`/api/redis-workflow/campaigns/${campaignId}/activate-stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customMessage: "Hi there! I'd like to connect with you.",
          batchSize: 10
        })
      });

      console.log('📡 SSE Response:', { ok: response.ok, status: response.status });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('Response body is null - streaming not supported');
      }

      console.log('📡 Starting to read SSE stream...');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let eventCount = 0;

      let reading = true;
      while (reading) {
        const { done, value } = await reader.read();
        
        if (done) {
          console.log('✅ SSE stream completed');
          reading = false;
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            eventCount++;
            const jsonData = line.slice(6);
            
            try {
              const data = JSON.parse(jsonData);
              console.log(`📡 SSE Event #${eventCount}:`, data.type, data);

              if (data.type === 'start') {
                console.log(`🎬 START: ${data.total} leads, ${data.batches} batches`);
                setProgress({ current: 0, total: data.total });
              } 
              else if (data.type === 'progress') {
                console.log(`⏳ PROGRESS: ${data.current}/${data.total} (${data.percentage}%)`);
                setProgress({ current: data.current, total: data.total });
              } 
              else if (data.type === 'batch_delay') {
                console.log(`⏱️ DELAY: Waiting ${data.delayMinutes} min before batch ${data.nextBatch}`);
                setActivationStatus({
                  type: 'info',
                  message: `Waiting ${data.delayMinutes} minutes before next batch (${data.nextBatch}/${data.totalBatches})...`
                });
              }
              else if (data.type === 'limit_reached') {
                console.log(`⚠️ LIMIT REACHED: ${data.message}`);
                setActivationStatus({
                  type: 'warning',
                  message: data.message,
                  details: `${data.remaining} batches remaining. Resume tomorrow.`
                });
              }
              else if (data.type === 'complete') {
                console.log(`🎉 COMPLETE:`, data);
                setProgress({ current: data.total, total: data.total });
                setActivationStatus({
                  type: 'success',
                  message: `Workflow completed!`,
                  details: `Sent: ${data.sent}, Already Connected: ${data.alreadyConnected}, Already Pending: ${data.alreadyPending}, Failed: ${data.failed}`
                });
                setIsProcessing(false);
              } 
              else if (data.type === 'error') {
                console.log(`❌ ERROR:`, data.message);
                setActivationStatus({
                  type: 'error',
                  message: data.message,
                  details: data.details
                });
                setIsProcessing(false);
              }
            } catch (parseError) {
              console.error('❌ Failed to parse SSE JSON:', parseError);
            }
          }
        }
      }
      
      console.log(`✅ Total SSE events: ${eventCount}`);
    } catch (error) {
      console.error('❌ SSE Error:', error);
      setActivationStatus({
        type: 'error',
        message: 'Network error occurred while activating workflow',
        details: error.message
      });
      setIsProcessing(false);
    } finally {
      setIsRunning(false);
      console.log('🏁 Workflow execution finished');
    }
  };

  useEffect(() => {
    const detect = () => {
      const html = document.documentElement;
      const darkThemes = ['dark','business','night','dracula','forest','black','dim','sunset','halloween','synthwave','reachly-dark'];
      const lightThemes = ['light','corporate','cupcake','emerald','winter','lofi','pastel','bumblebee','garden','reachly'];
      const attrTheme = (html.getAttribute('data-theme') || document.body.getAttribute('data-theme') || '').toLowerCase();
      const hasDarkClass = html.classList.contains('dark') || document.body.classList.contains('dark');
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      const isDarkActive = attrTheme
        ? (darkThemes.includes(attrTheme) || /dark/i.test(attrTheme))
        : (hasDarkClass || prefersDark);
      setIsDark(isDarkActive);
    };
    detect();
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => detect();
    mql.addEventListener?.('change', handler);
    const obs = new MutationObserver(detect);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'], subtree: true });
    if (document.body) {
      obs.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    }
    return () => {
      mql.removeEventListener?.('change', handler);
      obs.disconnect();
    };
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      containerRef.current?.requestFullscreen?.();
    }
  };

  // Handle fullscreen changes to ensure workflow fits properly
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (document.fullscreenElement) {
        // In fullscreen, fit the workflow to the entire screen
        setTimeout(() => {
          if (rf.current) {
            rf.current.fitView({ padding: 0.05 });
          }
        }, 100);
      } else {
        // Exit fullscreen, fit back to normal view
        setTimeout(() => {
          if (rf.current) {
            rf.current.fitView({ padding: 0.1 });
          }
        }, 100);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Handle node deletion
  useEffect(() => {
    const handleDeleteNode = (event) => {
      const { nodeId } = event.detail;
      deleteNode(nodeId);
    };

    window.addEventListener('deleteNode', handleDeleteNode);
    return () => window.removeEventListener('deleteNode', handleDeleteNode);
  }, [deleteNode]);

  // Check for active jobs on mount (handles navigation back to campaign with paused job)
  useEffect(() => {
    const checkForActiveJob = async () => {
      if (!campaignId) return;
      
      try {
        console.log(`🔍 Checking for active jobs for campaign: ${campaignId.substring(0, 8)}...`);
        
        // Check database for any active job for this campaign
        const response = await fetch(`/api/campaigns/${campaignId}/active-job`);
        
        if (!response.ok) {
          console.log('No active job found or error checking');
          return;
        }
        
        const { job } = await response.json();
        
        if (job && ['processing', 'queued', 'paused'].includes(job.status)) {
          console.log(`✅ Found active job: ${job.id.substring(0, 8)}... | Status: ${job.status}`);
          
          // Restore job state
          setCurrentJobId(job.id);
          setIsRunning(job.status !== 'paused');
          setIsProcessing(job.status === 'processing');
          setProgress({ 
            current: job.processedLeads || 0, 
            total: job.totalLeads || 0,
            stage: null
          });
          
          // ✅ CRITICAL: Set status state so button visibility works correctly
          // This matches the structure that SSE events use
          setStatus({
            type: 'status',
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
            pausedAt: job.pausedAt
          });
          
          // Save to localStorage
          localStorage.setItem('currentJobId', job.id);
          localStorage.setItem('currentCampaignId', campaignId);
          
          // Show appropriate status message
          if (job.status === 'paused') {
            setActivationStatus({
              type: 'info',
              message: '⏸️ Workflow paused',
              details: 'Click Resume to continue where you left off.'
            });
          } else {
            setActivationStatus({
              type: 'info',
              message: '🔄 Workflow in progress',
              details: `Processing ${job.processedLeads || 0}/${job.totalLeads || 0} leads`
            });
          }
          
          // SSE will automatically connect when currentJobId is set
        } else {
          console.log('No active jobs found for this campaign');
        }
      } catch (error) {
        console.error('❌ Error checking for active job:', error);
      }
    };
    
    checkForActiveJob();
  }, [campaignId]);

  return (
    <div ref={containerRef} className={`w-full ${isFullscreen ? 'h-screen' : 'min-h-[1200px]'} ${isDark ? 'bg-gray-900' : 'bg-white/60'}`}>
      <div className={`${isFullscreen ? 'h-screen' : 'min-h-[1200px]'} relative p-5`}>
        <div className={`absolute inset-0 m-0 rounded-2xl ${isDark ? 'bg-gray-800 ring-gray-700' : 'bg-white ring-slate-300'} ring-1 shadow-inner overflow-hidden`}>        
        {/* Right vertical toolbar */}
        <div className="absolute right-6 top-1/2 -translate-y-1/2 z-50">
          <div className="flex flex-col items-stretch bg-[#0f172a]/90 border border-slate-700 rounded-2xl shadow-lg relative">
            <div className="tooltip tooltip-left" data-tip="Zoom in" role="tooltip">
              <button className="p-4 text-slate-200 hover:bg-white/5" onClick={zoomIn} aria-label="Zoom in" tabIndex={0}>
                <Plus className="h-6 w-6" />
              </button>
            </div>
            <div className="tooltip tooltip-left" data-tip="Center view" role="tooltip">
              <button className="p-4 text-slate-200 hover:bg-white/5" onClick={fit} aria-label="Center view" tabIndex={0}>
                <Target className="h-6 w-6" />
              </button>
            </div>
            <div className="tooltip tooltip-left" data-tip="Zoom out" role="tooltip">
              <button className="p-4 text-slate-200 hover:bg-white/5" onClick={zoomOut} aria-label="Zoom out" tabIndex={0}>
                <Minus className="h-6 w-6" />
              </button>
            </div>
            <div className="border-t border-slate-700 mx-4" />
            <div className="tooltip tooltip-left" data-tip={isFullscreen ? "Exit fullscreen" : "Fullscreen"} role="tooltip">
              <button className="p-4 text-slate-200 hover:bg-white/5" onClick={toggleFullscreen} aria-label="Fullscreen" tabIndex={0}>
                <Maximize2 className="h-6 w-6" />
              </button>
            </div>
            <div className="border-t border-slate-700 mx-4" />
            <div className="tooltip tooltip-left" data-tip="Save" role="tooltip">
              <button className="p-4 text-slate-200 hover:bg-white/5" onClick={() => { /* TODO: save handler */ }} aria-label="Save" tabIndex={0}>
                <Save className="h-6 w-6" />
              </button>
            </div>
            <div className="border-t border-slate-700 mx-4" />
            <div className="tooltip tooltip-left" data-tip="Back" role="tooltip">
              <button className="p-4 text-slate-200 hover:bg-white/5" onClick={() => {
                const params = new URLSearchParams();
                if (campaignId) params.set('campaignId', campaignId);
                if (campaignName) params.set('campaign', campaignName);
                router.push(`/dashboard/workflow?${params.toString()}`);
              }} aria-label="Back" tabIndex={0}>
                <Undo2 className="h-6 w-6" />
              </button>
            </div>
          </div>
        </div>

        <ReactFlow
          key={`rf-${isDark ? 'dark' : 'light'}`}
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onInit={onInit}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          proOptions={{ hideAttribution: true }}
          snapToGrid
          snapGrid={[16, 16]}
          minZoom={0.3}
          maxZoom={2}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          translateExtent={[[-200, 0], [2200, 3000]]}
          nodeExtent={[[-200, 50], [2200, 2950]]}
          nodesDraggable={true}
          nodesConnectable={false}
          elementsSelectable={true}
          selectNodesOnDrag={false}
          connectOnClick={false}
          zoomOnDoubleClick={false}
          panOnDrag={false}
          panOnScroll={false}
          zoomOnScroll={true}
          preventScrolling={false}
          defaultEdgeOptions={{
            type: "smoothstep",
            animated: false,
            style: { stroke: "#94a3b8", strokeWidth: 5 },
            markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15, color: "#94a3b8" },
          }}
          connectionLineStyle={{ stroke: "#94a3b8", strokeWidth: 5 }}
          className="react-flow__dark"
        >
          {/* Removed default ReactFlow controls to avoid bottom-left plus button */}
          <Background variant="dots" gap={18} size={1} color={isDark ? "#6b7280" : "#cbd5e1"} />
        </ReactFlow>
        {/* Progress Bar - Compact Top-Right */}
        {(isProcessing || preflightStage) && (
          <div className="absolute top-4 right-4 z-[120] w-[22rem] max-w-full">
            <div
              className={`rounded-2xl shadow-2xl backdrop-blur-xl border px-4 py-3 ${
                isDark
                  ? 'bg-slate-900/85 border-white/10 text-slate-100'
                  : 'bg-white/90 border-slate-200 text-slate-800'
              }`}
            >
              <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em] font-semibold opacity-70 mb-2">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-gradient-to-r from-primary to-secondary animate-pulse" />
                  {preflightStage ? 'Initializing workflow' : 'Background workflow'}
                </span>
                <span>
                  {preflightStage || progress.total === 0
                    ? '...'
                    : `${Math.min(100, Math.round((progress.current / progress.total) * 100))}%`}
                </span>
              </div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold">
                    {preflightStage
                      ? getStageDescription(preflightStage)
                      : progress.stage
                        ? getStageDescription(progress.stage)
                        : progress.current === 0 && progress.total === 1
                          ? 'Connecting...'
                          : 'Processing...'}
                  </span>
                  {!preflightStage && progress.total > 0 && (
                    <span className="text-xs font-mono opacity-70">
                      {Math.ceil(progress.current)}/{progress.total} leads
                    </span>
                  )}
                </div>
                <span className="text-xs font-semibold">
                  {status?.status === 'paused'
                    ? 'Paused'
                    : preflightStage
                      ? 'Preparing'
                      : status?.status === 'processing'
                        ? 'In progress'
                        : 'Working'}
                </span>
              </div>
              <div className="w-full h-3 rounded-full overflow-hidden bg-gradient-to-r from-slate-200/40 via-slate-300/50 to-slate-200/40 dark:from-white/10 dark:via-white/15 dark:to-white/10 border border-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary via-secondary to-accent transition-all duration-500 ease-out shadow-[0_0_15px_rgba(248,121,65,0.35)]"
                  style={{
                    width: preflightStage
                      ? '18%'
                      : progress.total > 0
                        ? `${Math.min(100, Math.max(5, (progress.current / progress.total) * 100))}%`
                        : '12%',
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Status Display */}
        {activationStatus && !isProcessing && (
          <div className={`absolute top-4 left-4 right-4 z-50 alert ${
            activationStatus.type === 'success' ? 'alert-success' : 
            activationStatus.type === 'warning' ? 'alert-warning' :
            activationStatus.type === 'info' ? 'alert-info' : 'alert-error'
          } shadow-xl`}>
            <AlertCircle className="h-4 w-4" />
            <div>
              <div className="font-medium">{activationStatus.message}</div>
              {activationStatus.details && (
                <div className="text-xs opacity-75">{activationStatus.details}</div>
              )}
            </div>
          </div>
        )}

        {/* Bottom action bar */}
        <div className={`absolute left-0 right-0 bottom-0 px-6 h-16 ${isDark ? 'bg-[#0f172a] border-slate-700' : 'bg-slate-50 border-slate-200'} border-t flex items-center justify-between backdrop-blur-sm`}>
          <div className={`text-xs ${isDark ? 'text-slate-300' : 'text-slate-600'} max-w-2xl leading-relaxed`}>
            {campaignId ? (
              <>Campaign: <span className="font-medium">{campaignName}</span> (ID: {campaignId})</>
            ) : (
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-warning" />
                <span>No campaign selected. Please navigate from a campaign to run this workflow.</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button className="btn btn-ghost btn-sm text-slate-400 hover:text-slate-200" onClick={() => router.back()}>
              Back
            </button>
            
            {/* Run Background Button */}
            <button 
              className="btn btn-primary btn-sm px-4 font-medium shadow-lg hover:shadow-xl transition-all duration-200"
              onClick={handleRunWorkflowBackground}
              disabled={(currentJobId && ['processing', 'paused'].includes(status?.status)) || isRunning || !campaignId}
              title={
                !campaignId ? 'No campaign selected' :
                (currentJobId && ['processing', 'paused'].includes(status?.status))
                  ? 'A workflow is already running' 
                  : 'Run in background (survives browser close)'
              }
            >
              <Play className="h-4 w-4 mr-2" />
              Run Background
            </button>
            
            {/* Dynamic Stop/Resume Button */}
            <button 
              className={`btn btn-sm px-4 font-medium shadow-lg transition-all duration-200 ${
                status?.status === 'paused' ? 'btn-success' : 'btn-warning'
              }`}
              onClick={status?.status === 'paused' ? handleResumeWorkflow : handlePauseWorkflow}
              disabled={!currentJobId || !status || !['processing', 'paused', 'queued'].includes(status?.status)}
              title={
                status?.status === 'paused' ? 'Resume workflow' : 
                status?.status === 'processing' || status?.status === 'queued' ? 'Pause workflow' : 
                'Only available when processing or paused'
              }
            >
              {status?.status === 'paused' ? (
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
            
            {/* Cancel Button */}
            <button 
              className="btn btn-error btn-sm px-4 font-medium shadow-lg transition-all duration-200"
              onClick={handleCancelWorkflow}
              disabled={!currentJobId || !status || !['processing', 'paused', 'queued'].includes(status?.status)}
              title={
                (currentJobId && status && ['processing', 'paused', 'queued'].includes(status?.status))
                  ? 'Permanently cancel workflow' 
                  : 'No active workflow to cancel'
              }
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
