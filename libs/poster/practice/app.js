/* The practice site: a stand-in for Indeed's "Post a job" flow, running in the page. Nothing here talks to Indeed, and it says
   so on every page. The posting engine uses it for practice runs (so the window, the typing, the hand-overs and the review can
   be seen without any account) and the tests use it too.
   It reproduces what the real flow was recorded to have (docs/ai-hiring/19, section 5d): the same paths, data-testids and
   ids, custom drop-downs, an autocomplete for the location, a rich-text description box, a review page, the "No thanks"
   confirmation on the sponsor page, and a single-page app that moves between steps without reloading.
   Options come from window.__OPTIONS__. The page keeps what a test needs to look at in window.__log, __keys and __S. */
(function () {
  var OPT = window.__OPTIONS__ || {};
  var S = { title: "", wtype: "In person", loc: "", types: [], timeline: "Select", hires: "0", ptype: "Range", min: "33,000", max: "200,000", period: "per month", desc: "", method: "Email" };
  window.__S = S;
  window.__log = [];
  window.__keys = [];
  var root = document.getElementById("root");

  function esc(text) { return String(text).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function log(entry) { window.__log.push(entry); }
  function go(path) { history.pushState({}, "", path); render(); }
  window.addEventListener("popstate", render);

  function closeLists() { document.querySelectorAll("[data-mock-list]").forEach(function (el) { el.remove(); }); }
  function openList(anchor, items, onPick) {
    closeLists();
    var ul = document.createElement("ul");
    ul.setAttribute("role", "listbox");
    ul.setAttribute("data-mock-list", "1");
    var box = anchor.getBoundingClientRect();
    ul.style.cssText = "position:absolute;z-index:50;background:#fff;border:1px solid #888;margin:0;padding:4px;list-style:none;left:" + (box.left + window.scrollX) + "px;top:" + (box.bottom + window.scrollY) + "px;min-width:" + Math.max(box.width, 180) + "px";
    items.forEach(function (text) {
      var li = document.createElement("li");
      li.setAttribute("role", "option");
      li.style.cssText = "padding:6px 8px;cursor:pointer";
      li.textContent = text;
      li.addEventListener("click", function () { log("option:" + text); closeLists(); onPick(text); });
      ul.appendChild(li);
    });
    document.body.appendChild(ul);
  }
  function dropdown(testid, label, getValue, setValue, options) {
    var el = root.querySelector('[data-testid="' + testid + '"]');
    el.addEventListener("click", function () { openList(el, options, function (text) { setValue(text); el.textContent = text; }); });
    el.setAttribute("aria-label", label);
    el.textContent = getValue();
  }
  function header() {
    return '<div style="background:#fde68a;color:#422006;padding:6px 10px;font:600 13px sans-serif;text-align:center">PRACTICE SITE: this is not Indeed. Nothing typed here goes anywhere.</div>' +
      '<header style="padding:8px;border-bottom:1px solid #ccc"><button data-testid="account-menu-toggle-expand" aria-label="employer@example.com">employer@example.com</button></header>';
  }
  function footer(opts) {
    return '<footer style="margin-top:24px"><button data-testid="footer-back-btn">Back</button> <button data-testid="footer-continue-btn">' + (opts && opts.label ? opts.label : "Continue") + "</button></footer>";
  }
  function onContinue(handler) {
    root.querySelector('[data-testid="footer-continue-btn"]').addEventListener("click", function () { log("click:" + (this.textContent || "").trim()); handler(); });
  }

  function jobs() {
    document.title = "Jobs - Indeed for Employers";
    root.innerHTML = header() + '<main><h1>Jobs</h1><p>0 results</p><button id="post-a-job">Post a job</button></main>';
    root.querySelector("#post-a-job").addEventListener("click", function () { log("click:Post a job"); go(OPT.chooseFlow ? "/job-posting/choose-flow" : "/job-posting/from-scratch/getting-started"); });
  }
  function choose() {
    document.title = "Post a job - Indeed for Employers";
    root.innerHTML = header() + '<main><h1>How do you want to create your job?</h1><button id="scratch">Start from scratch</button><button id="template">Use a template</button></main>';
    root.querySelector("#scratch").addEventListener("click", function () { log("click:scratch"); go("/job-posting/from-scratch/getting-started"); });
  }

  function basics() {
    document.title = "Add job basics - Indeed for Employers";
    root.innerHTML = header() + '<main><h1>Add job basics</h1>' +
      '<label for="job-title-input-7x">Job title *</label><input id="job-title-input-7x" type="text" role="combobox" aria-expanded="false" autocomplete="off">' +
      '<div data-testid="job-location-type-selector" role="combobox" tabindex="0"></div>' +
      '<label for="loc-1">What is the job location? *</label><input id="loc-1" data-testid="location-input-component" type="text" role="combobox" aria-expanded="false" autocomplete="off" placeholder="Enter a city or location">' +
      '</main>' + footer();
    var title = root.querySelector("#job-title-input-7x");
    title.value = S.title;
    title.addEventListener("keydown", function () { window.__keys.push(Math.round(performance.now())); });
    title.addEventListener("input", function () { S.title = title.value; });
    dropdown("job-location-type-selector", "job location type *", function () { return S.wtype; }, function (v) { S.wtype = v; }, ["In person", "Fully remote", "Hybrid", "On the road"]);
    var loc = root.querySelector("#loc-1");
    loc.value = S.loc;
    S.locChosen = false;
    loc.addEventListener("input", function () {
      S.loc = loc.value;
      S.locChosen = false;
      if (OPT.noLocationSuggestions || loc.value.length < 3) { closeLists(); return; }
      openList(loc, [loc.value.trim() + ", Pakistan", loc.value.trim() + " Cantt, Pakistan"], function (text) { loc.value = text; S.loc = text; S.locChosen = true; });
    });
    onContinue(function () {
      if (OPT.requireLocationChoice && !S.locChosen) { document.body.insertAdjacentHTML("beforeend", '<div role="alert" id="err">Choose a location from the list</div>'); return; }
      if (OPT.titlePrompt && !window.__titleAsked) {
        window.__titleAsked = true;
        document.body.insertAdjacentHTML("beforeend", '<div role="dialog" id="title-dialog"><p>Your job title may need changes: it can only include the job title.</p><button id="title-go">Continue anyway</button></div>');
        document.getElementById("title-go").addEventListener("click", function () { log("click:Continue anyway"); document.getElementById("title-dialog").remove(); go("/job-posting/from-scratch/hiring-details"); });
        return;
      }
      go("/job-posting/from-scratch/hiring-details");
    });
  }

  function hiring() {
    document.title = "Add hiring details - Indeed for Employers";
    var types = ["Contract", "Part-time", "Full-time", "Fresher", "Temporary", "Internship"];
    root.innerHTML = header() + "<main><h1>Add hiring details</h1><fieldset><legend>Job type *</legend>" +
      types.map(function (t) { return '<label class="chip" style="margin-right:8px;padding:4px 8px;border:1px solid #888;display:inline-block"><input type="checkbox" name="job-type-chip" value="' + t.toLowerCase() + '" style="opacity:0;position:absolute"><span>' + t + "</span></label>"; }).join("") +
      '</fieldset><div data-testid="expect-hire-date-input" role="combobox" tabindex="0"></div>' +
      '<label>Number of people to hire in the next 30 days *<input data-testid="job-hires-needed-input" type="text" value="' + esc(S.hires) + '"></label>' +
      '<button data-testid="hire-minus-btn" aria-label="Decrease number of hires">-</button><button data-testid="hire-plus-btn" aria-label="Increase number of hires">+</button></main>' + footer();
    root.querySelectorAll('input[name="job-type-chip"]').forEach(function (box) {
      box.checked = S.types.indexOf(box.value) !== -1;
      box.addEventListener("change", function () { S.types = Array.prototype.filter.call(root.querySelectorAll('input[name="job-type-chip"]'), function (b) { return b.checked; }).map(function (b) { return b.value; }); });
    });
    dropdown("expect-hire-date-input", "hiring timeline for this job *", function () { return S.timeline; }, function (v) { S.timeline = v; }, ["Immediately", "1 to 3 days", "3 to 7 days", "1 to 2 weeks", "More than 2 weeks"]);
    var hires = root.querySelector('[data-testid="job-hires-needed-input"]');
    hires.addEventListener("input", function () { S.hires = hires.value; });
    root.querySelector('[data-testid="hire-plus-btn"]').addEventListener("click", function () { hires.value = String((Number(hires.value) || 0) + 1); S.hires = hires.value; });
    root.querySelector('[data-testid="hire-minus-btn"]').addEventListener("click", function () { hires.value = String(Math.max(0, (Number(hires.value) || 0) - 1)); S.hires = hires.value; });
    onContinue(function () { go("/job-posting/from-scratch/compensation-details"); });
  }

  function pay() {
    document.title = "Add pay and benefits - Indeed for Employers";
    root.innerHTML = header() + '<main><h1>Add pay and benefits</h1><h2>Pay</h2><p>Review the pay we estimated for your job and adjust as needed.</p>' +
      '<div data-testid="pay-type-selector" role="combobox" tabindex="0"></div>' +
      '<label for="jobMinimumPayInput">Minimum</label><input id="jobMinimumPayInput" name="minimum" type="text">' +
      '<label for="jobMaximumPayInput">Maximum</label><input id="jobMaximumPayInput" name="maximum" type="text">' +
      '<div data-testid="pay-period-selector" role="combobox" tabindex="0"></div></main>' + footer();
    dropdown("pay-type-selector", "show pay by", function () { return S.ptype; }, function (v) { S.ptype = v; }, ["Range", "Starting amount", "Maximum amount", "Exact amount"]);
    dropdown("pay-period-selector", "rate", function () { return S.period; }, function (v) { S.period = v; }, ["per hour", "per day", "per week", "per month", "per year"]);
    ["Minimum", "Maximum"].forEach(function (name) {
      var box = root.querySelector("#job" + name + "PayInput");
      var key = name === "Minimum" ? "min" : "max";
      box.value = S[key];
      box.addEventListener("input", function () { S[key] = box.value; });
      box.addEventListener("blur", function () { var n = Number(box.value.replace(/,/g, "")); if (n) { box.value = n.toLocaleString("en-US"); S[key] = box.value; } });
    });
    onContinue(function () { go("/job-posting/from-scratch/job-description"); });
  }

  function description() {
    document.title = "Describe the job - Indeed for Employers";
    root.innerHTML = header() + '<main><h1>Describe the job</h1><p id="desc-label">Job description *</p>' +
      '<div role="textbox" contenteditable="true" aria-multiline="true" aria-labelledby="desc-label" style="min-height:160px;border:1px solid #888;padding:8px"></div>' +
      '<button data-testid="clear-job-description-button">Delete job description</button></main>' + footer();
    var box = root.querySelector('[role="textbox"]');
    box.innerText = S.desc;
    box.addEventListener("input", function () { S.desc = box.innerText; });
    onContinue(function () { go("/job-posting/from-scratch/review-job"); });
  }

  function review() {
    document.title = "Review - Indeed for Employers";
    var shortDesc = S.desc.length > 120 ? S.desc.slice(0, 120) + "…" : S.desc;
    root.innerHTML = header() + "<main><h1>Review</h1><h2>Job details</h2>" +
      '<button data-testid="job-title-review-field-action">' + esc(OPT.reviewTitle || S.title) + "</button>" +
      '<button data-testid="number-of-openings-review-field-action">' + esc(S.hires) + "</button>" +
      '<button data-testid="location-review-field-action">' + esc(S.loc.split(",")[0]) + "</button>" +
      '<button data-testid="job-type-review-field-action">' + esc(S.types.map(function (t) { return t.charAt(0).toUpperCase() + t.slice(1); }).join(", ")) + "</button>" +
      '<button data-testid="pay-review-field-action">Rs' + esc(S.min) + ".00 - Rs" + esc(S.max) + ".00 " + esc(S.period) + "</button>" +
      '<button data-testid="job-description-review-field-action">' + esc(shortDesc) + "</button>" +
      "<h2>Settings</h2>" +
      '<button data-testid="application-method-review-field-action">' + esc(S.method) + "</button>" +
      '<button data-testid="hiring-timeline-review-field-action">' + esc(S.timeline) + "</button></main>" + footer({ label: "Confirm" });
    onContinue(function () { window.__confirms = (window.__confirms || 0) + 1; go("/sponsor/sponsor/budget-tiers"); });
  }

  function sponsor() {
    document.title = "Sponsor job - Indeed for Employers";
    root.innerHTML = header() + "<main><h1>Sponsor job</h1><h2>Choose a plan</h2>" +
      '<label><input type="radio" name="budget-option-radio" value="basic"> Basic US$1 daily average</label>' +
      '<label><input type="radio" name="budget-option-radio" value="standard"> Standard US$5 daily average</label>' +
      '<label><input type="radio" name="budget-option-radio" value="premium" checked> Premium US$10 daily average</label>' +
      '<div><button id="no-thanks">No thanks</button> <button id="save-continue">Save and continue</button></div></main>';
    root.querySelector("#save-continue").addEventListener("click", function () { log("PAID:Save and continue"); window.__paid = true; });
    root.querySelector("#no-thanks").addEventListener("click", function () {
      log("click:No thanks");
      if (OPT.noSponsorConfirm) { go("/jobs/view?jobId=abc123&utm=ignored"); return; }
      document.body.insertAdjacentHTML("beforeend", '<div role="dialog" id="sure"><h2>Are you sure you don\'t want to sponsor this job?</h2><button id="claim">Claim credit</button><button id="no-thanks-2">No thanks</button></div>');
      document.getElementById("claim").addEventListener("click", function () { log("PAID:Claim credit"); window.__paid = true; });
      document.getElementById("no-thanks-2").addEventListener("click", function () { log("click:No thanks (confirm)"); document.getElementById("sure").remove(); go("/jobs/view?jobId=abc123&utm=ignored"); });
    });
  }

  function view() {
    document.title = "Job Details - Indeed for Employers";
    root.innerHTML = header() + "<main><h1>" + esc(S.title) + '</h1><div data-testid="top-level-job-status" role="combobox">Pending</div><p>Your job is not posted on Indeed yet.</p></main>';
  }

  function render() {
    closeLists();
    var p = location.pathname;
    if (p === "/jobs") jobs();
    else if (/choose-flow/.test(p)) choose();
    else if (/getting-started/.test(p)) basics();
    else if (/hiring-details/.test(p)) hiring();
    else if (/compensation-details/.test(p)) pay();
    else if (/job-description/.test(p)) description();
    else if (/review-job/.test(p)) review();
    else if (/^\/sponsor\//.test(p)) sponsor();
    else if (/^\/jobs\/view/.test(p)) view();
    else root.innerHTML = header() + "<main><h1>Settings</h1><p>Nothing to post here.</p></main>";
  }
  render();
})();
