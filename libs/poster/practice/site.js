// The practice site: serves a stand-in for Indeed's employer area (practice/app.js) to a browser context, for
// https://employers.indeed.com and https://secure.indeed.com. The requests are answered in this process and every request to
// any other address is refused, so a practice run cannot reach Indeed or anything else. Used by the posting engine for practice
// runs and by the tests. Relative imports only.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = fs.readFileSync(path.join(here, "app.js"), "utf8");

const page = (body, script = "") => `<!doctype html><html><head><meta charset="utf-8"><title>Indeed</title></head><body><div id="root"></div>${body}${script}</body></html>`;

// A verification check the person clears with the button (the real one is Cloudflare's), or that a test clears from outside
const CHECK = `<!doctype html><html><head><meta charset="utf-8"><title>Just a moment...</title></head><body style="font-family:sans-serif;max-width:560px;margin:60px auto">
<div style="background:#fde68a;color:#422006;padding:6px 10px;font-weight:600;text-align:center">PRACTICE SITE: this is not Indeed.</div>
<h1>Additional Verification Required</h1><p>Verify you are human. This stands in for the verification check Indeed can show. The posting engine never clicks it: you do.</p>
<button id="verify" style="padding:10px 18px;font-size:16px">Verify (practice)</button>
<script>
document.getElementById("verify").addEventListener("click", async () => { await fetch("/__verify"); location.reload(); });
setInterval(async () => { const r = await fetch("/__status").then((x) => x.json()); if (!r.check) location.reload(); }, 400);
</script></body></html>`;

// What Indeed showed on 2026-10-08 in a window driven by automation: no widget to complete, only a Ray ID and a way home
const BLOCKED = `<!doctype html><html><head><meta charset="utf-8"><title>Just a moment...</title></head><body style="font-family:sans-serif;max-width:560px;margin:60px auto">
<div style="background:#fde68a;color:#422006;padding:6px 10px;font-weight:600;text-align:center">PRACTICE SITE: this is not Indeed.</div>
<h1>Additional Verification Required</h1><p>Your Ray ID for this request is a46f2681e927712c</p><button>Return home</button></body></html>`;

// What Indeed showed on 2026-10-08 for an employer account it had flagged
const PAUSED = `<!doctype html><html><head><meta charset="utf-8"><title>We've paused access to your employer account</title></head><body style="font-family:sans-serif;max-width:560px;margin:60px auto">
<div style="background:#fde68a;color:#422006;padding:6px 10px;font-weight:600;text-align:center">PRACTICE SITE: this is not Indeed.</div>
<h1>We've paused access to your employer account</h1><p>Indeed has noticed an issue with your account. This may include insufficient account information or unusual login activity.</p></body></html>`;

const SIGN_IN = `<!doctype html><html><head><meta charset="utf-8"><title>Sign in - Indeed</title></head><body style="font-family:sans-serif;max-width:560px;margin:60px auto">
<div style="background:#fde68a;color:#422006;padding:6px 10px;font-weight:600;text-align:center">PRACTICE SITE: this is not Indeed.</div>
<h1>Sign in to the practice site</h1><button id="go" style="padding:10px 18px;font-size:16px">Continue (practice)</button>
<script>document.getElementById("go").addEventListener("click", async () => { await fetch("/__signin"); location.href = "https://employers.indeed.com/jobs"; })</script></body></html>`;

/**
 * Install the practice site on a context. Options: signedIn (default true), check (show a verification check until it is
 * cleared with its button or by clearCheck()), blocked (a block page with nothing to complete), paused (a paused account),
 * and the page options read by practice/app.js (chooseFlow, titlePrompt,
 * noLocationSuggestions, requireLocationChoice, noSponsorConfirm, reviewTitle).
 */
export async function installPracticeSite(context, options = {}) {
  const state = { signedIn: options.signedIn !== false, check: Boolean(options.check), requests: [] };
  const appOptions = JSON.stringify({
    chooseFlow: options.chooseFlow, titlePrompt: options.titlePrompt, noLocationSuggestions: options.noLocationSuggestions,
    requireLocationChoice: options.requireLocationChoice, noSponsorConfirm: options.noSponsorConfirm, reviewTitle: options.reviewTitle,
  });
  // Registered first, so it is asked last: anything that is not the practice site is refused
  await context.route(/^(?!https:\/\/(employers|secure)\.indeed\.com\/)/, (route) => route.abort());
  await context.route(/^https:\/\/(employers|secure)\.indeed\.com\//, async (route) => {
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
    if (url.hostname === "secure.indeed.com") return html(SIGN_IN);
    // A page-side redirect, not a 302: a redirect answered here is followed on the real network
    if (!state.signedIn) return html(`<!doctype html><title>Redirecting</title><script>location.replace("https://secure.indeed.com/auth?continue=employers")</script>`);
    if (options.paused) return html(PAUSED);
    if (options.blocked) return html(BLOCKED);
    if (state.check) return html(CHECK);
    return html(page("", `<script>window.__OPTIONS__ = ${appOptions};</script><script>${APP}</script>`));
  });
  return {
    state,
    clearCheck: () => { state.check = false; },
    showCheck: () => { state.check = true; },
  };
}
