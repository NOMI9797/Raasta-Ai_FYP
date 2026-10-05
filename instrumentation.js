// Runs once when the web server starts (Next.js instrumentation hook, enabled in next.config.js).
// The Node-only part lives in its own file so the Edge runtime never tries to load it.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startHiringWorkerHost } = await import("./instrumentation-node");
    startHiringWorkerHost();
  }
}
