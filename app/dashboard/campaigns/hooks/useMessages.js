"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback } from "react";
import toast from "react-hot-toast";
import { messageKeys } from "./queryKeys";
import { messageApi } from "./api";

/**
 * Custom hook for managing AI message generation and history using React Query
 * Handles generating messages, loading message history, and managing copied states with caching
 */
export function useMessages() {
  const queryClient = useQueryClient();
  const [currentLeadId, setCurrentLeadId] = useState(null);
  const [generatedMessage, setGeneratedMessage] = useState("");
  const [copiedStates, setCopiedStates] = useState(new Set());
  const [isStreaming, setIsStreaming] = useState(false);

  // Available AI models
  const models = [
    { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B", description: "Fast and efficient" },
    { value: "llama3-8b-8192", label: "Llama 3 8B", description: "Alternative fast model" },
    { value: "mixtral-8x7b-32768", label: "Mixtral 8x7B", description: "Balanced performance" },
    { value: "gemma-7b-it", label: "Gemma 7B", description: "Good for creative tasks" },
  ];

  // Load message history for a lead with React Query
  const {
    data: rawMessageHistory = [],
    isLoading: isLoadingHistory,
    error: historyError,
    refetch: refetchHistory,
  } = useQuery({
    queryKey: messageKeys.forLead(currentLeadId),
    queryFn: () => messageApi.fetchMessageHistory(currentLeadId),
    enabled: !!currentLeadId, // Only fetch if leadId is provided
    staleTime: 1000 * 60 * 2, // 2 minutes
    retry: 2,
  });

  // Transform message history
  const messageHistory = rawMessageHistory.map(msg => ({
    id: msg.id,
    message: msg.content,
    timestamp: msg.createdAt,
    model: msg.model,
    postsAnalyzed: msg.postsAnalyzed,
    tokensUsed: msg.tokensUsed || 0,
  }));

  // Generate message mutation
  const generateMessageMutation = useMutation({
    mutationFn: messageApi.generateMessage,
    onSuccess: (newMessage, variables) => {
      const transformedMessage = {
        id: newMessage.id,
        message: newMessage.content,
        timestamp: newMessage.createdAt,
        model: newMessage.model,
        postsAnalyzed: newMessage.postsAnalyzed,
        tokensUsed: newMessage.tokensUsed,
      };

      // Update generated message state
      setGeneratedMessage(newMessage.content);

      // Optimistically update the message history cache
      queryClient.setQueryData(messageKeys.forLead(variables.leadId), (oldMessages = []) => [
        newMessage,
        ...oldMessages,
      ]);

      toast.success("Message generated successfully!");
    },
    onError: (error) => {
      setGeneratedMessage("Error: Failed to generate message - " + error.message);
      toast.error(`Failed to generate message: ${error.message}`);
    },
  });

  // Delete message mutation
  const deleteMessageMutation = useMutation({
    mutationFn: messageApi.deleteMessage,
    onSuccess: (_, messageId) => {
      // Remove from cache
      if (currentLeadId) {
        queryClient.setQueryData(messageKeys.forLead(currentLeadId), (oldMessages = []) =>
          oldMessages.filter(msg => msg.id !== messageId)
        );
      }

      // Clear current message if it was the deleted one
      if (generatedMessage && messageHistory[0]?.id === messageId) {
        setGeneratedMessage("");
      }

      toast.success("Message deleted successfully!");
    },
    onError: (error) => {
      toast.error("Failed to delete message");
    },
  });

  // Load message history for a lead
  const loadMessageHistory = (leadId) => {
    if (!leadId) {
      setCurrentLeadId(null);
      setGeneratedMessage("");
      return;
    }

    setCurrentLeadId(leadId);

    // Only set cached message if we're not currently streaming
    if (!isStreaming) {
      const cachedMessages = queryClient.getQueryData(messageKeys.forLead(leadId));
      if (cachedMessages && cachedMessages.length > 0) {
        setGeneratedMessage(cachedMessages[0].content);
      } else {
        // Clear message if no cached messages found for this lead
        setGeneratedMessage("");
      }
    }
  };

  // Generate a new message with streaming
  const generateMessage = async (leadId, aiSettings = {}) => {
    if (!leadId) {
      toast.error("No lead selected");
      return false;
    }

    try {
      setIsStreaming(true);
      // Force clear the message and ensure it's empty
      setGeneratedMessage("");
      
      // Small delay to ensure state is updated
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const response = await fetch('/api/messages/generate-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          leadId,
          model: aiSettings?.model || "llama-3.1-8b-instant",
          customPrompt: aiSettings?.customPrompt || "",
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to start message generation');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('Response body is not readable');
      }

      let buffer = '';

      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        const value = result.value;
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === 'start') {
                // Initial start message - ensure message is empty
                setGeneratedMessage("");
              } else if (data.type === 'chunk') {
                // Ensure we're building from scratch, not appending to existing
                setGeneratedMessage(prev => {
                  // If this is the first chunk, start fresh
                  if (prev === "") {
                    return data.content;
                  }
                  return prev + data.content;
                });
              } else if (data.type === 'done') {
                // Message completed, refresh history
                if (currentLeadId) {
                  queryClient.invalidateQueries({ queryKey: messageKeys.forLead(currentLeadId) });
                }
                toast.success("Message generated successfully!");
                setIsStreaming(false);
                return true;
              } else if (data.type === 'error') {
                throw new Error(data.error);
              }
            } catch (parseError) {
              console.error('Error parsing SSE data:', parseError);
            }
          }
        }
      }

      setIsStreaming(false);
      return true;
    } catch (error) {
      console.error('Streaming error:', error);
      setGeneratedMessage("Error: Failed to generate message - " + error.message);
      toast.error(`Failed to generate message: ${error.message}`);
      setIsStreaming(false);
      return false;
    }
  };

  // Copy text to clipboard
  const copyToClipboard = useCallback(async (text, messageId = "current") => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for older browsers
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }

      setCopiedStates(prev => new Set(prev).add(messageId));
      toast.success("Message copied to clipboard!");
      
      // Clear copied state after 2 seconds
      setTimeout(() => {
        setCopiedStates(prev => {
          const newSet = new Set(prev);
          newSet.delete(messageId);
          return newSet;
        });
      }, 2000);
      
      return true;
    } catch (err) {
      console.error("Failed to copy text:", err);
      toast.error("Failed to copy text. Please select and copy manually.");
      return false;
    }
  }, []);

  // Delete a message
  const deleteMessage = async (messageId) => {
    return deleteMessageMutation.mutateAsync(messageId);
  };

  // Clear current message
  const clearCurrentMessage = useCallback(() => {
    setGeneratedMessage("");
  }, []);

  // Clear all messages and reset state
  const clearMessages = useCallback(() => {
    setGeneratedMessage("");
    setCopiedStates(new Set());
    setCurrentLeadId(null);
    // Clear React Query cache for current lead
    if (currentLeadId) {
      queryClient.removeQueries({ queryKey: messageKeys.forLead(currentLeadId) });
    }
  }, [currentLeadId, queryClient]);

  // Format timestamp utility
  const formatTimestamp = useCallback((timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }, []);

  return {
    // State
    generatedMessage,
    setGeneratedMessage,
    isGenerating: generateMessageMutation.isPending || isStreaming,
    isStreaming,
    messageHistory,
    copiedStates,
    error: historyError?.message || generateMessageMutation.error?.message || null,
    models,
    
    // Actions
    loadMessageHistory,
    generateMessage,
    copyToClipboard,
    deleteMessage,
    clearCurrentMessage,
    clearMessages,
    
    // Utilities
    formatTimestamp,

    // Additional React Query specific properties
    isLoadingHistory,
    isDeletingMessage: deleteMessageMutation.isPending,
    currentLeadId,
  };
}
