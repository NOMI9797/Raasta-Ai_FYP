/* Raasta-AI Poster: the panel shown beside a platform's own job form.
 *
 * Runs on the platform pages listed in manifest.json, and only shows itself when Raasta-AI has sent a kit for that
 * platform. The person stays in charge: the panel offers Copy for every field and a best-effort Fill, and it never
 * clicks the platform's buttons or submits anything. The platform's own Post button is theirs to press.
 *
 * Everything from the kit is written into the panel with textContent, never as HTML.
 */
(function () {
  "use strict";
  const KIT = globalThis.RaastaPosterKit;
  const FILL = globalThis.RaastaPosterFill;
  const platform = KIT.platformForHost(window.location.hostname);
  if (!platform) return;
  const KEY = "kit:" + platform;

  const STYLE = `
    :host { all: initial; }
    .panel { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: min(380px, calc(100vw - 32px)); max-height: 82vh;
      display: flex; flex-direction: column; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2933;
      background: #fff; border: 1px solid #c9d1d9; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.22); }
    header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #0f3d91; color: #fff; border-radius: 11px 11px 0 0; }
    header strong { flex: 1; font-size: 13px; }
    header button { all: unset; cursor: pointer; padding: 2px 8px; border-radius: 6px; font-size: 12px; background: rgba(255,255,255,.18); color: #fff; }
    header button:hover, header button:focus-visible { background: rgba(255,255,255,.32); outline: 2px solid #fff; }
    .body { padding: 12px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
    .job { font-weight: 600; }
    .muted { color: #5f6b7a; font-size: 12px; }
    .note { background: #eef4ff; border-radius: 8px; padding: 8px 10px; font-size: 12px; }
    .tip { background: #fff7e0; border: 1px solid #f0d58a; border-radius: 8px; padding: 8px 10px; font-size: 12px; }
    .row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-top: 1px solid #e6eaef; }
    .row .name { flex: 0 0 96px; font-weight: 600; font-size: 12px; }
    .row .val { flex: 1; min-width: 0; color: #3d4852; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
    button.act { all: unset; cursor: pointer; padding: 5px 10px; border-radius: 6px; border: 1px solid #0f3d91; color: #0f3d91; font-size: 12px; background: #fff; text-align: center; }
    button.act:hover, button.act:focus-visible { background: #eef4ff; outline: 2px solid #0f3d91; }
    button.primary { background: #0f3d91; color: #fff; }
    button.primary:hover, button.primary:focus-visible { background: #0b2f73; }
    button.quiet { border-color: #c9d1d9; color: #3d4852; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .results { margin: 0; padding-left: 16px; font-size: 12px; }
    .ok { color: #0a7a3d; } .warn { color: #a15c00; }
    input.link { width: 100%; box-sizing: border-box; padding: 6px 8px; border: 1px solid #c9d1d9; border-radius: 6px; font-size: 12px; }
  `;

  let kit = null;
  let host = null;
  let root = null;
  let collapsed = false;
  let dismissed = false;
  let fillResults = null;
  let doneMessage = "";
  let reportText = "";

  function el(tag, props, children) {
    const node = document.createElement(tag);
    Object.keys(props || {}).forEach((name) => {
      if (name === "className") node.className = props[name];
      else if (name === "text") node.textContent = props[name];
      else if (name.startsWith("on")) node.addEventListener(name.slice(2), props[name]);
      else node.setAttribute(name, props[name]);
    });
    (children || []).forEach((child) => child && node.appendChild(child));
    return node;
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // The page may not allow the clipboard API: fall back to a temporary box and the copy command
      const box = document.createElement("textarea");
      box.value = text;
      box.style.cssText = "position:fixed;opacity:0;top:0;left:0";
      document.body.appendChild(box);
      box.select();
      const ok = document.execCommand("copy");
      box.remove();
      return ok;
    }
  }

  function minutesLeft() {
    return Math.max(0, Math.round((new Date(kit.expiresAt).getTime() - Date.now()) / 60000));
  }

  function discard() {
    return chrome.storage.local.remove(KEY);
  }

  async function posted(linkInput) {
    const link = linkInput.value.trim() ? KIT.safeEntryUrl(platform, linkInput.value.trim()) : "";
    const stored = await chrome.storage.local.get("confirmations");
    const list = Array.isArray(stored.confirmations) ? stored.confirmations : [];
    list.push({ id: String(Date.now()) + "-" + Math.random().toString(36).slice(2, 8), jobId: kit.jobId, platform: platform, postUrl: link, at: new Date().toISOString() });
    await chrome.storage.local.set({ confirmations: list.slice(-20) });
    doneMessage = "Saved. Raasta-AI marks the job as posted on " + kit.platformLabel + " as soon as you open it (or now, if it is open in another tab).";
    kit = null;
    await discard();
    render();
  }

  // A description of this page's form to paste to whoever tunes Fill: names, selectors, what would go where. No typed values.
  async function copyReport(button) {
    const report = FILL.report(document, kit, { version: chrome.runtime.getManifest().version });
    reportText = JSON.stringify(report, null, 2);
    const ok = await copy(reportText);
    if (ok) { reportText = ""; button.textContent = "Report copied"; setTimeout(() => { button.textContent = "Copy page report"; }, 2000); }
    else render(); // the clipboard was refused: show the text to copy by hand
  }

  function fillForm() {
    fillResults = FILL.fillKit(document, kit);
    render();
  }

  // What Fill did on this page. A platform's form comes in steps, so most kit fields are simply not on the current
  // one: say that once, quietly, instead of listing each as a problem.
  function resultsView() {
    const by = (status) => fillResults.filter((r) => r.status === status);
    const names = (list) => list.map((r) => r.label).join(", ");
    const lines = [];
    if (by("filled").length) lines.push(el("div", { className: "ok", text: "Filled: " + names(by("filled")) + ". Check each one." }));
    if (by("kept").length) lines.push(el("div", { className: "warn", text: "Left as it was: " + names(by("kept")) }));
    if (by("failed").length) lines.push(el("div", { className: "warn", text: "Could not fill, use Copy: " + names(by("failed")) }));
    if (!by("filled").length && !by("kept").length && !by("failed").length) {
      lines.push(el("div", { className: "warn", text: "Nothing on this page matches the job's fields. They may come on a later step; use Copy for anything you need." }));
    } else if (by("not_found").length) {
      lines.push(el("div", { className: "muted", text: "Not on this page: " + names(by("not_found")) }));
    }
    return el("div", { className: "results" }, lines);
  }

  // Advice for the steps of a platform's flow that has been seen on a real account. Matched on the page's path only,
  // so a platform that changes its steps just shows no tip.
  const TIPS = {
    indeed: [
      { path: /\/getting-started/, text: "Job location type is a drop-down that Fill cannot use: pick it yourself (the Workplace type row below says what the job is). If Indeed shows a list of places under Location, pick the matching one." },
      { path: /\/hiring-details/, text: "Fill ticks the job type. The hiring timeline and the number of people to hire are yours to choose: Raasta-AI does not know them." },
      { path: /\/compensation-details/, text: "Indeed fills in its own pay estimate here. Check it, and replace it with the job's pay if the job has one before you continue." },
      { path: /\/job-description/, text: "Fill types the description into Indeed's editor. Check that the apply link at the end is still there." },
      { path: /\/review-job/, text: "Check Application method. Raasta-AI screens the people who apply through its own Apply link, so send applicants there. With Indeed's default (Email) they skip Raasta-AI." },
      { path: /\/sponsor\//, text: "Indeed may pre-select a paid Sponsored plan. To post without paying, choose \"No thanks\". Nothing on this page is chosen for you." },
      { path: /\/jobs\/view/, text: "Finished? Indeed may keep the job as Pending while it reviews it. Click I posted it so Raasta-AI records that you submitted it." },
    ],
    rozee: [],
  };

  function tipsHere() {
    const path = window.location.pathname;
    return (TIPS[platform] || []).filter((tip) => tip.path.test(path)).map((tip) => tip.text);
  }

  function render() {
    if (dismissed) return remove();
    if (!kit && !doneMessage) return remove();
    if (!host) {
      host = document.createElement("div");
      host.setAttribute("data-raasta-poster", "");
      root = host.attachShadow({ mode: "open" });
      document.documentElement.appendChild(host);
    }
    root.replaceChildren(el("style", { text: STYLE }));

    const header = el("header", {}, [
      el("strong", { text: "Raasta-AI Poster" }),
      kit ? el("button", { type: "button", onclick: () => { collapsed = !collapsed; render(); }, "aria-expanded": String(!collapsed), text: collapsed ? "Show" : "Minimise" }) : null,
      el("button", { type: "button", onclick: () => { dismissed = true; render(); }, text: "Hide" }),
    ]);
    const panel = el("section", { className: "panel", role: "region", "aria-label": "Raasta-AI Poster" }, [header]);

    if (!kit) {
      panel.appendChild(el("div", { className: "body" }, [el("div", { className: "note", text: doneMessage })]));
    } else if (!collapsed) {
      const body = el("div", { className: "body" });
      body.appendChild(el("div", {}, [
        el("div", { className: "job", text: kit.jobTitle || "Job" }),
        el("div", { className: "muted", text: [kit.place, kit.platformLabel, "kit expires in " + minutesLeft() + " min"].filter(Boolean).join(" · ") }),
      ]));
      body.appendChild(el("div", { className: "note", text: "Nothing is submitted for you. Fill or copy each field, check it, then press " + kit.platformLabel + "'s own button to post." }));
      tipsHere().forEach((text) => body.appendChild(el("div", { className: "tip", role: "note", text: "This step: " + text })));
      const reportButton = el("button", { type: "button", className: "act quiet", text: "Copy page report", title: "Copies a description of this page's form (names and selectors, never what you typed) to paste to whoever is tuning Fill" });
      reportButton.addEventListener("click", () => copyReport(reportButton));
      body.appendChild(el("div", { className: "actions" }, [el("button", { type: "button", className: "act primary", onclick: fillForm, text: "Fill the form" }), reportButton]));
      if (reportText) body.appendChild(el("textarea", { readonly: "", "aria-label": "Page report to copy", rows: "6", style: "width:100%;box-sizing:border-box;font:11px monospace" }, []));
      if (fillResults) body.appendChild(resultsView());

      kit.fields.forEach((field) => {
        const button = el("button", { type: "button", className: "act", text: "Copy", "aria-label": "Copy " + field.label });
        button.addEventListener("click", async () => {
          const done = (await copy(field.value)) ? "Copied" : "Press Ctrl+C";
          // The label changes with the text, so a screen reader hears the result and not only "Copy"
          button.textContent = done;
          button.setAttribute("aria-label", done + ": " + field.label);
          setTimeout(() => { button.textContent = "Copy"; button.setAttribute("aria-label", "Copy " + field.label); }, 1500);
        });
        body.appendChild(el("div", { className: "row" }, [
          el("span", { className: "name", text: field.label }),
          el("span", { className: "val", text: field.value.replace(/\s+/g, " ").slice(0, 80), title: field.value.slice(0, 300) }),
          button,
        ]));
      });

      const link = el("input", { type: "url", className: "link", placeholder: "Link to the live post (optional)", "aria-label": "Link to the live post" });
      body.appendChild(link);
      body.appendChild(el("div", { className: "actions" }, [
        el("button", { type: "button", className: "act primary", onclick: () => posted(link), text: "I posted it" }),
        el("button", { type: "button", className: "act quiet", onclick: () => { fillResults = null; discard(); }, text: "Discard kit" }),
      ]));
      panel.appendChild(body);
    }
    root.appendChild(panel);
    const box = root.querySelector("textarea[aria-label='Page report to copy']");
    if (box) { box.value = reportText; box.select(); }
  }

  function remove() {
    if (host) { host.remove(); host = null; root = null; }
  }

  async function load() {
    const stored = await chrome.storage.local.get(KEY);
    const checked = KIT.validate(stored[KEY]);
    kit = checked.ok ? checked.kit : null;
    if (!checked.ok && stored[KEY]) discard(); // expired or invalid: do not keep it around
    if (kit) { dismissed = false; doneMessage = ""; fillResults = null; }
    render();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[KEY]) load();
  });
  // The platforms' flows are single-page apps: the path changes without a reload. Show the tip for the new step and
  // forget what Fill reported on the old one.
  let lastPath = window.location.pathname;
  setInterval(() => {
    if (window.location.pathname === lastPath) return;
    lastPath = window.location.pathname;
    fillResults = null;
    if (kit) render();
  }, 800);

  // Keep the "expires in" line honest, and drop the kit once it has expired
  setInterval(() => { if (kit) { if (KIT.isExpired(kit)) load(); else if (!collapsed) render(); } }, 30000);
  load();
})();
