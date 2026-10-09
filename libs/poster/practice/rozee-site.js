// The Rozee.pk practice site: serves a stand-in for RozeeGPT's employer area (practice/rozee-app.js) to a browser context, for
// https://www.rozeegpt.ai and https://hiring.rozee.pk. The requests are answered in this process and every request to any
// other address is refused, so a practice run cannot reach Rozee.pk or anything else. Used by the posting engine for practice
// runs and by the tests. Relative imports only.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = fs.readFileSync(path.join(here, "rozee-app.js"), "utf8");

const NOTE = '<div style="background:#fde68a;color:#422006;padding:6px 10px;font:600 13px sans-serif;text-align:center">PRACTICE SITE: this is not Rozee.pk.</div>';

const CHECK = `<!doctype html><html><head><meta charset="utf-8"><title>Just a moment...</title></head><body style="font-family:sans-serif;max-width:560px;margin:60px auto">${NOTE}
<h1>Additional Verification Required</h1><p>Verify you are human. This stands in for a verification check. The posting engine never clicks it: you do.</p>
<button id="verify" style="padding:10px 18px;font-size:16px">Verify (practice)</button>
<script>
document.getElementById("verify").addEventListener("click", async () => { await fetch("/__verify"); location.reload(); });
setInterval(async () => { const r = await fetch("/__status").then((x) => x.json()); if (!r.check) location.reload(); }, 400);
</script></body></html>`;

const SIGN_IN = `<!doctype html><html><head><meta charset="utf-8"><title>Login to your account - ROZEE.PK</title></head><body style="font-family:sans-serif;max-width:560px;margin:60px auto">${NOTE}
<h1>Login to the practice site</h1><button id="go" style="padding:10px 18px;font-size:16px">Continue (practice)</button>
<script>document.getElementById("go").addEventListener("click", async () => { await fetch("/__signin"); location.href = "https://www.rozeegpt.ai/employer/dashboard"; })</script></body></html>`;

/**
 * Install the practice site on a context. Options: signedIn (default true), check (a verification check until it is cleared with
 * its button or by clearCheck()), and the page options read by practice/rozee-app.js (skills, moreSkills, noCities, slowAi, dashboardDelayMs).
 */
export async function installRozeePracticeSite(context, options = {}) {
  const state = { signedIn: options.signedIn !== false, check: Boolean(options.check), requests: [] };
  const appOptions = JSON.stringify({ skills: options.skills, moreSkills: options.moreSkills, noCities: options.noCities, slowAi: options.slowAi, dashboardDelayMs: options.dashboardDelayMs });
  const ours = /^https:\/\/(www\.rozeegpt\.ai|hiring\.rozee\.pk)\//;
  // Registered first, so it is asked last: anything that is not the practice site is refused
  await context.route(/^(?!https:\/\/(www\.rozeegpt\.ai|hiring\.rozee\.pk)\/)/, (route) => route.abort());
  await context.route(ours, async (route) => {
    const url = new URL(route.request().url());
    state.requests.push(`${route.request().method()} ${url.hostname}${url.pathname}`);
    const html = (body) => route.fulfill({ status: 200, contentType: "text/html", body });
    const text = (body) => route.fulfill({ status: 200, contentType: "text/plain", body });
    if (url.pathname === "/__status") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ check: state.check, signedIn: state.signedIn }) });
    if (url.pathname === "/__verify") {
      state.check = false;
      return text("ok");
    }
    if (url.pathname === "/__signin") {
      state.signedIn = true;
      return text("ok");
    }
    if (url.hostname === "hiring.rozee.pk") return html(SIGN_IN);
    // A page-side redirect, not a 302: a redirect answered here is followed on the real network
    if (!state.signedIn) return html(`<!doctype html><title>Redirecting</title><script>location.replace("https://hiring.rozee.pk/login")</script>`);
    if (state.check) return html(CHECK);
    return html(`<!doctype html><html><head><meta charset="utf-8"><title>RozeeGPT</title></head><body><div id="root"></div><script>window.__OPTIONS__ = ${appOptions};</script><script>${APP}</script></body></html>`);
  });
  return {
    state,
    clearCheck: () => { state.check = false; },
    showCheck: () => { state.check = true; },
  };
}
