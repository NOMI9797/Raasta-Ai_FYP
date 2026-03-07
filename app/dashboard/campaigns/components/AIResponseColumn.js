"use client";

import { useEffect, memo } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Wand2,
  Copy,
  Settings,
  Loader2,
  Sparkles,
  Trash2,
  Check,
  RefreshCw,
  MessageSquare,
  Clock,
  User,
} from "lucide-react";
import { useMessages } from "../hooks/useMessages";

const AIResponseColumn = memo(function AIResponseColumn({
  selectedLead,
  campaignId,
  collapsed,
  onToggleCollapse,
  onOpenSettings,
  aiSettings,
  setAiSettings,
}) {
  const {
    generatedMessage,
    setGeneratedMessage,
    isGenerating,
    isStreaming,
    messageHistory,
    copiedStates,
    error,
    models,
    loadMessageHistory,
    generateMessage,
    copyToClipboard,
    deleteMessage,
    clearCurrentMessage,
    formatTimestamp,
  } = useMessages();

  // Load message history when lead changes
  useEffect(() => {
    if (selectedLead) {
      const leadId = selectedLead._id || selectedLead.id;
      loadMessageHistory(leadId);
    }
  }, [selectedLead, loadMessageHistory]);


  if (collapsed) {
    return (
      <div className="h-full flex flex-col items-center py-4 bg-base-100">
        <button
          onClick={onToggleCollapse}
          className="btn btn-ghost btn-sm btn-circle mb-4"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <div className="writing-mode-vertical text-sm text-base-content/60">
          AI Response
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-base-100">
      {/* Header */}
      <div className="p-3 border-b border-base-300">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="font-bold text-base-content">AI Message Generator</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onToggleCollapse}
              className="btn btn-ghost btn-sm btn-circle"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
        </div>

        {selectedLead && (
          <div className="text-sm text-base-content/60 mb-3">
            Generating for:{" "}
            <span className="text-base-content font-medium">
              {selectedLead.name || "Selected Lead"}
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {!selectedLead ? (
          <div className="text-center text-base-content/60 py-8">
            <Wand2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Select a lead to generate messages</p>
          </div>
        ) : selectedLead.status !== "completed" ? (
          <div className="text-center text-base-content/60 py-8">
            <Loader2 className="h-8 w-8 mx-auto mb-2 opacity-50 animate-spin" />
            <p className="text-sm">Wait for lead processing to complete</p>
          </div>
        ) : (
          <>
            {/* Generate Button */}
            <button
              onClick={() => {
                const leadId = selectedLead._id || selectedLead.id;
                generateMessage(leadId, aiSettings);
              }}
              disabled={isGenerating}
              className="btn btn-primary w-full gap-2"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {isStreaming ? "Streaming..." : "Generating..."}
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4" />
                  Generate Personalized Message
                </>
              )}
            </button>

            {/* Current Generated Message */}
            {(generatedMessage || isStreaming) && (
              <div className="card bg-base-100 border border-base-300">
                <div className="card-body p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="card-title text-sm">
                      {isStreaming ? "Generating Message..." : "Generated Message"}
                    </h3>
                    <div className="flex gap-1">
                      <button
                        onClick={() => copyToClipboard(generatedMessage || "", "current")}
                        disabled={!generatedMessage}
                        className={`btn btn-ghost btn-xs btn-circle ${
                          copiedStates.has("current")
                            ? "text-success bg-success/10"
                            : ""
                        } ${!generatedMessage ? "opacity-50 cursor-not-allowed" : ""}`}
                        title={generatedMessage ? (copiedStates.has("current") ? "Copied!" : "Copy message") : "No message to copy"}
                      >
                        {copiedStates.has("current") ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                      <button
                        onClick={clearCurrentMessage}
                        className="btn btn-ghost btn-xs btn-circle text-error hover:text-error"
                        title="Delete message"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <div className="p-3 bg-base-200 rounded-lg text-sm leading-relaxed min-h-[60px]">
                    {generatedMessage}
                    {isStreaming && (
                      <span className="inline-block ml-1 animate-pulse">...</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-3 text-xs text-base-content/60">
                    <span>
                      Model: {models.find((m) => m.value === aiSettings?.model)?.label || aiSettings?.model || "llama-3.1-8b-instant"}
                    </span>
                    <span>{generatedMessage?.length || 0} characters</span>
                  </div>
                </div>
              </div>
            )}

            {/* Message History */}
            {messageHistory.length > 1 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-base-content">
                    Previous Messages
                  </h3>
                  <div className="badge badge-outline badge-sm">
                    {messageHistory.length - 1}
                  </div>
                </div>

                {messageHistory.slice(1).map((item) => (
                  <div key={item.id} className="card bg-base-200 border border-base-300">
                    <div className="card-body p-3">
                      <div className="text-sm leading-relaxed mb-2">
                        {item.message}
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs text-base-content/60">
                          <Clock className="h-3 w-3" />
                          {formatTimestamp(item.timestamp)}
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => copyToClipboard(item.message, item.id)}
                            className={`btn btn-ghost btn-xs btn-circle ${
                              copiedStates.has(item.id)
                                ? "text-success bg-success/10"
                                : ""
                            }`}
                            title={copiedStates.has(item.id) ? "Copied!" : "Copy message"}
                          >
                            {copiedStates.has(item.id) ? (
                              <Check className="h-3 w-3" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                          <button
                            onClick={() => deleteMessage(item.id)}
                            className="btn btn-ghost btn-xs btn-circle text-error hover:text-error"
                            title="Delete message"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});

export default AIResponseColumn;
