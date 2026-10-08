/**
 * Raasta-AI posting engine (docs/ai-hiring/19-platform-publishing.md, section 5f).
 *
 * Usage: npm run poster:engine   (tsx services/poster-engine/index.js)
 *
 * Waits for posting runs queued from the Publish panel, opens a visible browser window on THIS machine, fills the
 * platform's post form in like a person, and hands over to the recruiter at every check, sign-in and decision. Run it on
 * the recruiter's own computer. GET /health on 127.0.0.1:POSTER_ENGINE_PORT (default 8095).
 */
import "../../libs/load-env";
import { startEngine } from "../../libs/poster/engine";

startEngine()
  .then((engine) => {
    const shutdown = async () => {
      await engine.stop().catch(() => {});
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  })
  .catch((error) => {
    console.error(JSON.stringify({ service: "poster-engine", level: "error", event: "start_failed", error: String(error.message).split("\n")[0] }));
    process.exit(1);
  });
