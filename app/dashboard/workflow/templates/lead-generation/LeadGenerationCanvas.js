"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Minus, Maximize2, Save, Target, Undo2, Trash2 } from "lucide-react";
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
  { id: "start", position: { x: 250, y: 25 }, data: { label: "Send an invite", icon: "🛈" }, type: "default", style: nodeWrapperStyle },
  { id: "left1", position: { x: 100, y: 250 }, data: { label: "Follow", icon: "🖼" }, style: nodeWrapperStyle },
  { id: "left2", position: { x: 100, y: 400 }, data: { label: "View profile", icon: "◎" }, style: nodeWrapperStyle },
  { id: "left3", position: { x: 100, y: 550 }, data: { label: "End of sequence", isEnd: true, icon: "■" }, style: nodeWrapperStyle },

  { id: "right1", position: { x: 400, y: 250 }, data: { label: "Endorse skills", icon: "✓" }, style: nodeWrapperStyle },
  { id: "right2", position: { x: 400, y: 400 }, data: { label: "Message", icon: "✉" }, style: nodeWrapperStyle },
  { id: "right3", position: { x: 400, y: 550 }, data: { label: "Message", icon: "✉" }, style: nodeWrapperStyle },
  { id: "right4", position: { x: 400, y: 700 }, data: { label: "Message", icon: "✉" }, style: nodeWrapperStyle },
  { id: "right5", position: { x: 400, y: 850 }, data: { label: "End of sequence", isEnd: true, icon: "■" }, style: nodeWrapperStyle },
];

const initialEdges = [
  { id: "e-start-l1", source: "start", target: "left1", type: "delay", data: { pill: "5 days", caption: "Still not accepted", captionColor: "#ef4444", dashed: true }, style: edgeStyle, markerEnd: { type: MarkerType.ArrowClosed, color: "#3b475e" } },
  { id: "e-start-r1", source: "start", target: "right1", type: "delay", data: { pill: "1 hour", caption: "Accepted", captionColor: "#10b981", captionOnTop: true }, style: edgeStyle, markerEnd: { type: MarkerType.ArrowClosed, color: "#3b475e" } },

  { id: "e-l1-l2", source: "left1", target: "left2", type: "delay", data: { pill: "5 days", caption: "Still not accepted", captionColor: "#ef4444", dashed: true }, style: edgeStyle, markerEnd: { type: MarkerType.ArrowClosed, color: "#3b475e" } },
  { id: "e-l2-l3", source: "left2", target: "left3", type: "delay", data: { pill: "20 days", caption: "Still not accepted", captionColor: "#ef4444", dashed: true }, style: edgeStyle, markerEnd: { type: MarkerType.ArrowClosed, color: "#3b475e" } },

  { id: "e-r1-r2", source: "right1", target: "right2", type: "delay", data: { pill: "1 hour" }, style: edgeStyle, markerEnd: { type: MarkerType.ArrowClosed, color: "#3b475e" } },
  { id: "e-r2-r3", source: "right2", target: "right3", type: "delay", data: { pill: "3 days" }, style: edgeStyle, markerEnd: { type: MarkerType.ArrowClosed, color: "#3b475e" } },
  { id: "e-r3-r4", source: "right3", target: "right4", type: "delay", data: { pill: "4 days" }, style: edgeStyle, markerEnd: { type: MarkerType.ArrowClosed, color: "#3b475e" } },
  { id: "e-r4-r5", source: "right4", target: "right5", type: "delay", data: { pill: "1 day" }, style: edgeStyle, markerEnd: { type: MarkerType.ArrowClosed, color: "#3b475e" } },
];

function DarkNode({ data, id }) {
  const isEnd = data?.isEnd;
  const [showDelete, setShowDelete] = useState(false);
  
  const handleDelete = (e) => {
    e.stopPropagation();
    // This will be handled by the parent component
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

export default function LeadGenerationCanvas({ campaignName, campaignId }) {
  const router = useRouter();
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const rf = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [isDark, setIsDark] = useState(true);
  const containerRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

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
      obs.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme'], subtree: true });
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
        {/* Bottom action bar */}
        <div className={`absolute left-0 right-0 bottom-0 px-6 h-16 ${isDark ? 'bg-[#0f172a] border-slate-700' : 'bg-slate-50 border-slate-200'} border-t flex items-center justify-between backdrop-blur-sm`}>
          <div className={`text-xs ${isDark ? 'text-slate-300' : 'text-slate-600'} max-w-2xl leading-relaxed`}>
            All leads that reply to your connection request, message or InMail will be put on hold, and further actions won&apos;t be performed
          </div>
          <div className="flex items-center gap-3">
            <button className="btn btn-ghost btn-sm text-slate-400 hover:text-slate-200" onClick={() => {/* TODO: hook cancel */}}>
              Cancel
            </button>
            <button className="btn btn-primary btn-sm px-6 font-medium shadow-lg hover:shadow-xl transition-all duration-200" onClick={() => {/* TODO: hook save */}}>
              Save
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}


