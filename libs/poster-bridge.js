// The Raasta-AI page's side of the link to the Raasta-AI Poster browser extension (extensions/raasta-poster/bridge.js).
// Browser only. The two talk through window.postMessage, same window and same origin, and nothing else: a kit of job
// text goes to the extension, and "the person says they posted it" comes back. No account or session passes either way.
// If the extension is not installed nothing answers; every call here then fails quietly and the page falls back to
// plain Copy and open.
const NS = "raasta-poster";
let counter = 0;

function request(type, payload = {}, timeoutMs = 700) {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("No browser window"));
      return;
    }
    const id = `${Date.now()}-${++counter}`;
    const finish = (settle, value) => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      settle(value);
    };
    const onMessage = (event) => {
      const message = event.data;
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (!message || message.ns !== NS || message.from !== "extension" || message.id !== id) return;
      if (message.type === "error") finish(reject, new Error(message.error || "The Raasta-AI Poster extension refused that"));
      else finish(resolve, message);
    };
    const timer = setTimeout(() => finish(reject, new Error("The Raasta-AI Poster extension did not answer")), timeoutMs);
    window.addEventListener("message", onMessage);
    window.postMessage({ ns: NS, from: "page", type, id, ...payload }, window.location.origin);
  });
}

/** { installed: boolean, version?: string }. An extension installed after this page loaded is found after a reload. */
export async function detectPoster() {
  try {
    const answer = await request("hello");
    return { installed: true, version: answer.version };
  } catch {
    return { installed: false };
  }
}

/** Hand a posting kit (libs/hiring/posting-kit.js) to the extension. Throws with a readable message if it refuses. */
export async function sendKit(kit) {
  return request("kit", { kit }, 2000);
}

/** Jobs the person marked as posted from the platform's page: [{ id, jobId, platform, postUrl, at }]. */
export async function pollConfirmations() {
  try {
    return (await request("poll")).items || [];
  } catch {
    return [];
  }
}

/** Tell the extension these have been recorded, so they are not offered again. */
export async function ackConfirmations(ids) {
  try {
    await request("ack", { ids });
  } catch {
    // The next poll offers them again; recording a post twice is harmless
  }
}
