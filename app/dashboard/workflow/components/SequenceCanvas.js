"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ZoomIn, ZoomOut, Maximize2, Minimize2, RefreshCcw, Save, LayoutTemplate, Crosshair } from "lucide-react";
import ReactFlow, { Background, Controls, MiniMap, addEdge, Handle, Position, useEdgesState, useNodesState, MarkerType } from "reactflow";
import "reactflow/dist/style.css";

function BaseNode({ icon, title, subtitle, status = "pending", isStart = false, selected = false }) {
  const getStatusColor = () => {
    switch (status) {
      case "completed": return "border-emerald-500 bg-emerald-50";
      case "running": return "border-sky-500 bg-sky-50";
      case "error": return "border-rose-500 bg-rose-50";
      default: return "border-gray-200 bg-white";
    }
  };

  return (
    <div className={`px-4 py-3 rounded-xl border ${getStatusColor()} min-w-[220px] shadow-sm ${selected ? "ring-2 ring-primary/30" : ""}`}>
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-sm">
          {icon}
        </div>
        <div className="flex-1">
          <div className="font-semibold text-sm text-gray-900">{title}</div>
          {subtitle && <div className="text-xs text-gray-500 mt-1">{subtitle}</div>}
        </div>
        {isStart && (
          <div className="bg-emerald-100 text-emerald-800 text-[10px] px-2 py-0.5 rounded-full font-medium">
            START
          </div>
        )}
      </div>
    </div>
  );
}

const VisitNode = ({ data, selected }) => (
  <div>
    <Handle type="target" position={Position.Top} className="w-3 h-3" />
    <BaseNode 
      icon="👁️" 
      title="Visit Profile" 
      subtitle="View profile page" 
      status={data?.status}
      isStart={data?.isStart}
      selected={selected}
    />
    <Handle type="source" position={Position.Bottom} className="w-3 h-3" />
  </div>
);

const FollowNode = ({ data, selected }) => (
  <div>
    <Handle type="target" position={Position.Top} className="w-3 h-3" />
    <BaseNode 
      icon="➕" 
      title="Follow" 
      subtitle="Follow the user" 
      status={data?.status}
      selected={selected}
    />
    <Handle type="source" position={Position.Bottom} className="w-3 h-3" />
  </div>
);

const ConnectNode = ({ data, selected }) => (
  <div>
    <Handle type="target" position={Position.Top} className="w-3 h-3" />
    <BaseNode 
      icon="🤝" 
      title="Connect" 
      subtitle="Send connection request" 
      status={data?.status}
      selected={selected}
    />
    <Handle type="source" position={Position.Bottom} className="w-3 h-3" />
  </div>
);

const DelayNode = ({ data, selected }) => (
  <div>
    <Handle type="target" position={Position.Top} className="w-3 h-3" />
    <BaseNode 
      icon="⏱️" 
      title="Wait" 
      subtitle={data?.delay || "2-4 hours"} 
      status={data?.status}
      selected={selected}
    />
    <Handle type="source" position={Position.Bottom} className="w-3 h-3" />
  </div>
);

const MessageNode = ({ data, selected }) => (
  <div>
    <Handle type="target" position={Position.Top} className="w-3 h-3" />
    <BaseNode 
      icon="💬" 
      title="Message" 
      subtitle={data?.messageType || "Message 1"} 
      status={data?.status}
      selected={selected}
    />
    <Handle type="source" position={Position.Bottom} className="w-3 h-3" />
  </div>
);

const BranchNode = ({ data, selected }) => (
  <div className="relative">
    <Handle type="target" position={Position.Top} className="w-3 h-3" />
    <div className={`relative min-w-[200px]`}>
      <div className="mx-auto w-28 h-28 relative">
        <div className={`absolute inset-0 rotate-45 rounded-lg border ${data?.status === "error" ? "border-rose-500 bg-rose-50" : data?.status === "running" ? "border-sky-500 bg-sky-50" : data?.status === "completed" ? "border-emerald-500 bg-emerald-50" : "border-gray-200 bg-white"} shadow-sm ${selected ? "ring-2 ring-primary/30" : ""}`}></div>
        <div className="absolute inset-0 -rotate-45 flex items-center justify-center">
          <div className="text-center">
            <div className="text-sm font-semibold text-gray-900">Branch</div>
            <div className="text-xs text-gray-500 mt-1">{data?.condition || "Reply detected?"}</div>
          </div>
        </div>
      </div>
    </div>
    <Handle id="yes" type="source" position={Position.Right} className="w-3 h-3" />
    <Handle id="no" type="source" position={Position.Bottom} className="w-3 h-3" />
  </div>
);

const nodeTypes = {
  visit: VisitNode,
  follow: FollowNode,
  connect: ConnectNode,
  wait: DelayNode,
  message: MessageNode,
  branch: BranchNode,
};

const initialNodes = [
  { id: "n1", type: "visit", position: { x: 300, y: 50 }, data: { status: "completed", isStart: true } },
  { id: "n2", type: "follow", position: { x: 300, y: 200 }, data: { status: "completed" } },
  { id: "n3", type: "connect", position: { x: 300, y: 350 }, data: { status: "running" } },
  { id: "n4", type: "wait", position: { x: 300, y: 500 }, data: { status: "pending", delay: "2-4 hours" } },
  { id: "n5", type: "message", position: { x: 300, y: 650 }, data: { status: "pending", messageType: "Follow-up message" } },
  { id: "n6", type: "branch", position: { x: 500, y: 650 }, data: { status: "pending", condition: "Reply detected?" } },
  { id: "n7", type: "message", position: { x: 700, y: 650 }, data: { status: "pending", messageType: "Reply to message" } },
  { id: "n8", type: "message", position: { x: 300, y: 800 }, data: { status: "pending", messageType: "No reply - continue" } },
];

const initialEdges = [
  { id: "e1-2", source: "n1", target: "n2", type: "smoothstep" },
  { id: "e2-3", source: "n2", target: "n3", type: "smoothstep" },
  { id: "e3-4", source: "n3", target: "n4", type: "smoothstep" },
  { id: "e4-5", source: "n4", target: "n5", type: "smoothstep" },
  { id: "e5-6", source: "n5", target: "n6", type: "smoothstep" },
  { id: "e6-7", source: "n6", sourceHandle: "yes", target: "n7", type: "smoothstep", label: "Yes" },
  { id: "e6-8", source: "n6", sourceHandle: "no", target: "n8", type: "smoothstep", label: "No" },
];

export default function SequenceCanvas() {
  const [fullscreen, setFullscreen] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const wrapperRef = useRef(null);
  const rfInstance = useRef(null);

  const onInit = useCallback((instance) => {
    rfInstance.current = instance;
    instance.fitView({ padding: 0.2 });
  }, []);

  const onConnect = useCallback(
    (connection) => setEdges((eds) => addEdge({ ...connection, type: "smoothstep" }, eds)),
    [setEdges]
  );

  const handleZoomIn = () => rfInstance.current?.zoomIn?.({ duration: 100 });
  const handleZoomOut = () => rfInstance.current?.zoomOut?.({ duration: 100 });
  const handleReset = () => rfInstance.current?.fitView?.({ padding: 0.2 });
  const toggleFullscreen = () => setFullscreen((v) => !v);

  const onDragStartPalette = (event, type) => {
    event.dataTransfer.setData("application/reactflow", type);
    event.dataTransfer.effectAllowed = "move";
  };

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/reactflow");
      if (!type) return;
      const bounds = wrapperRef.current.getBoundingClientRect();
      const position = rfInstance.current.project({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
      const id = `n-${Date.now()}`;
      setNodes((nds) => nds.concat({ id, type, position, data: {} }));
    },
    [setNodes]
  );

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onNodeClick = useCallback((_, node) => {
    setSelectedNodeId(node?.id || null);
  }, []);

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedNodeId) || null, [nodes, selectedNodeId]);

  return (
    <div className={`h-full w-full ${fullscreen ? "fixed inset-0 z-50 bg-base-100" : ""}`}>
      <div className="h-full flex">
        {/* Left Palette */}
        <div className="w-64 border-r border-base-300 p-4 bg-base-100 flex-shrink-0 overflow-y-auto min-h-0">
          <div className="text-[13px] font-semibold mb-3 text-base-content/80">Workflow Steps</div>
          <div className="grid grid-cols-1 gap-2">
            {[
              { type: "visit", label: "Visit Profile", emoji: "👁️" },
              { type: "follow", label: "Follow", emoji: "➕" },
              { type: "connect", label: "Connect", emoji: "🤝" },
              { type: "wait", label: "Wait", emoji: "⏱️" },
              { type: "message", label: "Message", emoji: "💬" },
              { type: "branch", label: "Branch", emoji: "🔀" },
            ].map((n) => (
              <div
                key={n.type}
                className="p-3 rounded-lg border border-base-300 bg-white hover:bg-base-200/60 cursor-grab active:cursor-grabbing select-none shadow-sm"
                draggable
                onDragStart={(e) => onDragStartPalette(e, n.type)}
              >
                <div className="flex items-center gap-3 text-[13px]">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-gray-100 text-sm">{n.emoji}</span>
                  <span className="font-medium text-gray-800">{n.label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 relative" ref={wrapperRef}>
          {/* Right Vertical Toolbar */}
          <div className="absolute right-4 top-1/2 -translate-y-1/2 z-10 flex flex-col gap-2">
            <button className="btn btn-sm btn-square btn-ghost border border-base-300" onClick={handleZoomIn} title="Zoom in">
              <ZoomIn className="h-4 w-4" />
            </button>
            <button className="btn btn-sm btn-square btn-ghost border border-base-300" onClick={handleZoomOut} title="Zoom out">
              <ZoomOut className="h-4 w-4" />
            </button>
            <button className="btn btn-sm btn-square btn-ghost border border-base-300" onClick={handleReset} title="Fit to view">
              <Crosshair className="h-4 w-4" />
            </button>
            <div className="divider my-1"></div>
            <button className="btn btn-sm btn-square btn-ghost border border-base-300" onClick={toggleFullscreen} title={fullscreen ? "Exit full screen" : "Enter full screen"}>
              {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button className="btn btn-sm btn-square btn-ghost border border-base-300" title="Save as template">
              <Save className="h-4 w-4" />
            </button>
            <button className="btn btn-sm btn-square btn-ghost border border-base-300" title="Back to templates">
              <LayoutTemplate className="h-4 w-4" />
            </button>
          </div>

          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={onInit}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
            snapToGrid
            snapGrid={[16, 16]}
            minZoom={0.4}
            maxZoom={1.5}
            defaultEdgeOptions={{
              type: "smoothstep",
              animated: false,
              style: { stroke: "#94a3b8", strokeWidth: 2 },
              markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: "#94a3b8" },
            }}
            connectionLineStyle={{ stroke: "#94a3b8", strokeWidth: 2 }}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={onNodeClick}
          >
            <MiniMap maskColor="rgba(0,0,0,0.04)" nodeStrokeColor="#94a3b8" nodeColor="#f8fafc" />
            <Controls showInteractive={false} />
            <Background variant="dots" gap={18} size={1} color="#e5e7eb" />
          </ReactFlow>
        </div>

        {/* Right Inspector */}
        <div className="w-80 border-l border-base-300 p-4 bg-base-100 flex-shrink-0 overflow-y-auto min-h-0">
          <div className="text-sm font-semibold mb-3">Configuration</div>
          {!selectedNode && (
            <div className="text-xs text-base-content/60">Select a node to configure its settings.</div>
          )}
          {selectedNode && (
            <div className="space-y-4">
              <div>
                <div className="text-[13px] text-base-content/70">Type</div>
                <div className="text-sm font-medium mt-1 capitalize">{selectedNode.type}</div>
              </div>
              {selectedNode.type === "wait" && (
                <div className="space-y-2">
                  <label className="text-[13px] text-base-content/70">Delay label</label>
                  <input
                    className="input input-sm input-bordered w-full"
                    value={selectedNode.data?.delay || ""}
                    onChange={(e) =>
                      setNodes((nds) => nds.map((n) => n.id === selectedNode.id ? { ...n, data: { ...n.data, delay: e.target.value } } : n))
                    }
                    placeholder="e.g. 2-4 hours"
                  />
                </div>
              )}
              {selectedNode.type === "message" && (
                <div className="space-y-2">
                  <label className="text-[13px] text-base-content/70">Label</label>
                  <input
                    className="input input-sm input-bordered w-full"
                    value={selectedNode.data?.messageType || ""}
                    onChange={(e) =>
                      setNodes((nds) => nds.map((n) => n.id === selectedNode.id ? { ...n, data: { ...n.data, messageType: e.target.value } } : n))
                    }
                    placeholder="Follow-up message"
                  />
                </div>
              )}
              {selectedNode.type === "branch" && (
                <div className="space-y-2">
                  <label className="text-[13px] text-base-content/70">Condition</label>
                  <input
                    className="input input-sm input-bordered w-full"
                    value={selectedNode.data?.condition || ""}
                    onChange={(e) =>
                      setNodes((nds) => nds.map((n) => n.id === selectedNode.id ? { ...n, data: { ...n.data, condition: e.target.value } } : n))
                    }
                    placeholder="Reply detected?"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


