// Streaming speech-to-text with Deepgram nova-3 (docs/ai-hiring/09-interview-engine.md).
// Interim results → onPartial, is_final results → onFinal. The SDK socket reconnects on its own;
// onClose fires only after close() or when it gives up.
// Relative imports only.

export const DEEPGRAM_OPTIONS = {
  model: "nova-3",
  language: "en",
  encoding: "linear16",
  sample_rate: "16000",
  channels: "1",
  interim_results: "true",
  smart_format: "true",
  punctuate: "true",
  endpointing: "300",
  utterance_end_ms: "1000",
  vad_events: "true",
  filler_words: "true", // keep "um" and "uh": the fluency score counts them
};

/**
 * Map one Deepgram message to a callback. Exported for tests.
 */
export function handleDeepgramMessage(message, { onPartial, onFinal, onActivity }) {
  if (message?.type === "SpeechStarted") {
    onActivity?.();
    return;
  }
  if (message?.type !== "Results") return;
  const text = message.channel?.alternatives?.[0]?.transcript?.trim();
  if (!text) return;
  if (message.is_final) {
    const startMs = Math.round((message.start || 0) * 1000);
    onFinal?.(text, { startMs, endMs: Math.round(startMs + (message.duration || 0) * 1000) });
  } else {
    onActivity?.();
    onPartial?.(text);
  }
}

/**
 * createDeepgramStt(handlers) → { write(pcm), keepAlive(), close() }
 * options.client lets tests inject a fake DeepgramClient.
 */
export function createDeepgramStt({ onPartial, onFinal, onError, onClose, onActivity }, { apiKey = process.env.DEEPGRAM_API_KEY, client } = {}) {
  let socket = null;
  let open = false;
  let closed = false;
  let closeNotified = false;
  const pending = []; // audio written before the socket opened
  let flushWaiter = null;
  const notifyClose = () => {
    if (!closeNotified) {
      closeNotified = true;
      onClose?.();
    }
  };

  const ready = (async () => {
    const { DeepgramClient } = client ? { DeepgramClient: null } : await import("@deepgram/sdk");
    const dg = client || new DeepgramClient({ apiKey });
    socket = await dg.listen.v1.connect(DEEPGRAM_OPTIONS);
    socket.on("message", (message) => handleDeepgramMessage(message, {
      onPartial,
      onActivity,
      onFinal: (text, timing) => {
        onFinal?.(text, timing);
        const waiter = flushWaiter;
        flushWaiter = null;
        waiter?.();
      },
    }));
    socket.on("error", (error) => onError?.(error));
    socket.on("close", () => {
      open = false;
      if (closed) notifyClose();
      else if (!closeNotified) {
        // Deepgram dropped the stream: the caller may reconnect once
        closeNotified = true;
        onClose?.({ unexpected: true });
      }
    });
    socket.connect();
    await socket.waitForOpen();
    open = true;
    while (pending.length && !closed) socket.sendMedia(pending.shift());
  })().catch((error) => {
    onError?.(error);
  });

  return {
    write(pcm) {
      if (closed) return;
      if (open) socket.sendMedia(pcm);
      else if (pending.length < 500) pending.push(pcm);
    },
    keepAlive() {
      if (open && !closed) socket.sendKeepAlive({ type: "KeepAlive" });
    },
    /** The candidate pressed "I've finished": ask Deepgram to finalise now; resolves on the next final or after timeoutMs. */
    flush({ timeoutMs = 1200 } = {}) {
      if (!open || closed) return Promise.resolve();
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          flushWaiter = null;
          resolve();
        }, timeoutMs);
        flushWaiter = () => {
          clearTimeout(timer);
          resolve();
        };
        try {
          socket.sendFinalize({ type: "Finalize" });
        } catch {
          clearTimeout(timer);
          flushWaiter = null;
          resolve();
        }
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      await ready;
      try {
        if (open) socket.sendCloseStream({ type: "CloseStream" });
        socket?.close();
      } catch {
        // already closed
      }
      if (!open) notifyClose();
    },
    ready,
  };
}
