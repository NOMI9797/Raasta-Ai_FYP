/* The Rozee.pk practice site: a stand-in for RozeeGPT's "post a job" wizard, running in the page. Nothing here talks to Rozee.pk, and
   it says so on every page. It reproduces what the real wizard was recorded to have on 2026-10-08 (docs/ai-hiring/19, section 5g):
   the dashboard with "Post A New Job", a drawer with one question per address, skill chips with a Required / Nice to Have menu, a
   city list that loads, the AI-written draft job page whose sections edit in place and save by themselves, and the publish dialog
   that spends a free credit or sells an upgrade. The posting engine uses it for practice runs and the tests use it too.
   Options come from window.__OPTIONS__. The page keeps what a test needs to look at in window.__log, __S and __published. */
(function () {
  var OPT = window.__OPTIONS__ || {};
  var SUGGESTED = (OPT.skills || ["Test Automation", "Agile Testing", "Continuous Integration", "Node.js", "React", "SQL", "Project Management"]).slice();
  var RESERVE = (OPT.moreSkills || []).slice(); // suggestions that appear after some skills are chosen, as on the real page
  var S = {
    title: "", skills: [], years: "", gender: "", manage: "", other: "", city: "", workplace: "On-Site", budget: "", cityOptions: null,
    desc: "Practice Co is seeking a dedicated professional to join our team. The ideal candidate is proficient in the listed skills.",
    resp: "Develop and maintain the product.\nTest changes before they ship.\nWork with the team to plan the next release.",
    published: false,
  };
  window.__S = S;
  window.__log = [];
  window.__published = false;
  var root = document.getElementById("root");

  function esc(text) { return String(text).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function log(entry) { window.__log.push(entry); }
  function go(path) { history.pushState({}, "", path); render(); }
  window.addEventListener("popstate", render);
  var BASE = "/employer/dashboard/postjob/";

  function banner() {
    return '<div style="background:#fde68a;color:#422006;padding:6px 10px;font:600 13px sans-serif;text-align:center">PRACTICE SITE: this is not Rozee.pk. Nothing typed here goes anywhere.</div>';
  }
  function sidebar() {
    return '<aside style="width:260px;float:left;background:#000;color:#fff;min-height:100vh;padding:16px;box-sizing:border-box">' +
      '<div>Practice Employer</div><div>practice.employer@example.com</div><div>+920000000000</div>' +
      '<button id="post-new" style="margin-top:16px;padding:10px 14px;background:#1d4ed8;color:#fff;border:0">Post A New Job</button></aside>';
  }

  function dashboard() {
    document.title = "RozeeGPT | Practice";
    root.innerHTML = banner() + sidebar() + '<main style="margin-left:280px;padding:16px"><h2>Hi! I am Rozeena, your practice recruiter.</h2>' +
      '<div style="padding:12px;background:#e0e7ff"><div>Posted: practice</div><div><b>Practice draft job</b> <span>Draft</span></div></div></main>';
    root.querySelector("#post-new").addEventListener("click", function () { log("click:Post A New Job"); go(BASE + "jobtitle"); });
  }

  // The wizard: a drawer over the dashboard, one question per address
  function drawer(inner) {
    document.title = "RozeeGPT | Practice";
    root.innerHTML = banner() + sidebar() + '<main style="margin-left:280px;padding:16px;opacity:.4">Dashboard</main>' +
      '<div class="MuiDrawer-root" style="position:fixed;top:30px;left:260px;width:520px;bottom:0;background:#fff;border-left:1px solid #999;padding:24px;box-sizing:border-box;overflow:auto">' +
      '<button aria-label="Close" id="close-drawer">x</button> <button id="back">Back</button><h1>Job Post</h1><p>Initiate your talent search by posting a job.</p>' + inner + "</div>";
    root.querySelector("#close-drawer").addEventListener("click", function () { go("/employer/dashboard"); });
    root.querySelector("#back").addEventListener("click", function () { history.back(); });
  }
  function boxWithArrow(name, placeholder, value, suffix) {
    return '<div class="MuiInputBase-root" style="display:flex;border:1px solid #333;border-radius:20px;padding:6px 12px"><input name="' + name + '" placeholder="' + placeholder + '" value="' + esc(value) + '" style="flex:1;border:0;outline:0">' +
      (suffix ? "<span>" + suffix + "</span>" : "") + '<button class="arrow" aria-hidden="false" style="border:0;background:none">&#10148;</button></div>';
  }
  function submitOnArrow(name, handler) {
    var input = root.querySelector('[name="' + name + '"]');
    root.querySelector(".arrow").addEventListener("click", function () { if (input.value.trim()) handler(input.value.trim()); });
    input.addEventListener("keydown", function (e) { if (e.key === "Enter" && input.value.trim()) handler(input.value.trim()); });
    return input;
  }

  function jobtitle() {
    drawer("<p>Who would you like to hire today?</p>" + boxWithArrow("jobTitle", "Enter Job Title", S.title) +
      '<label><input type="checkbox" id="optimise"> Use AI to Optimize Job Title</label>');
    root.querySelector('[name="jobTitle"]').addEventListener("input", function (e) { S.title = e.target.value; });
    root.querySelector("#optimise").addEventListener("change", function (e) { S.optimise = e.target.checked; log("optimise:" + e.target.checked); });
    submitOnArrow("jobTitle", function (value) { S.title = value; go(BASE + "chooseskills"); });
  }

  function skills() {
    var rows = SUGGESTED.filter(function (name) { return !S.skills.some(function (s) { return s.name === name; }); });
    var chosen = function (level) { return S.skills.filter(function (s) { return s.level === level; }).map(function (s) { return '<div class="MuiChip-root">' + esc(s.name) + " x</div>"; }).join(""); };
    drawer('<h2>' + esc(S.title) + "</h2><p>Here are some common skills needed for this role. Select the relevant ones.</p>" +
      '<div class="MuiStack-root">' + rows.map(function (name) { return '<div class="chip" style="display:inline-block;margin:4px;padding:8px 12px;background:#eee;cursor:pointer"><span class="MuiTypography-root">' + esc(name) + "</span></div>"; }).join("") + "</div>" +
      "<h3>Required</h3>" + chosen("Required") + "<h3>Nice to have</h3>" + chosen("Nice to Have") +
      '<div><button id="add-skill">Add New Skill +</button> <button id="go" ' + (S.skills.length ? "" : "disabled") + ">Continue</button></div>");
    root.querySelectorAll(".chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var name = chip.textContent.trim();
        var menu = document.createElement("ul");
        menu.setAttribute("role", "menu");
        menu.style.cssText = "position:absolute;background:#fff;border:1px solid #888;list-style:none;padding:6px;z-index:60";
        var box = chip.getBoundingClientRect();
        menu.style.left = box.left + window.scrollX + "px";
        menu.style.top = box.bottom + window.scrollY + "px";
        ["Required", "Nice to Have"].forEach(function (level) {
          var li = document.createElement("li");
          li.innerHTML = '<label style="cursor:pointer"><input type="checkbox"> <span>' + level + "</span></label>";
          li.querySelector("label").addEventListener("click", function (e) { e.preventDefault(); S.skills.push({ name: name, level: level }); log("skill:" + name + ":" + level); for (var n = 0; n < 2 && RESERVE.length; n += 1) SUGGESTED.push(RESERVE.shift()); menu.remove(); skills(); });
          menu.appendChild(li);
        });
        document.body.appendChild(menu);
      });
    });
    root.querySelector("#go").addEventListener("click", function () { log("click:Continue"); go(BASE + "experience"); });
  }

  function experience() {
    drawer("<p>What is the minimum experience required for this job?</p>" + boxWithArrow("experience", "5", S.years, "Years"));
    submitOnArrow("experience", function (value) { S.years = value; go(BASE + "genderpreference"); });
  }

  function gender() {
    drawer('<p>Gender preference?</p><input name="gender_preference" role="combobox" placeholder="Select gender preference" style="width:100%">');
    var input = root.querySelector('[name="gender_preference"]');
    function openList() {
      document.querySelectorAll("[data-list]").forEach(function (el) { el.remove(); });
      var ul = document.createElement("ul");
      ul.setAttribute("role", "listbox");
      ul.setAttribute("data-list", "1");
      var box = input.getBoundingClientRect();
      ul.style.cssText = "position:absolute;z-index:60;background:#fff;border:1px solid #888;list-style:none;margin:0;padding:4px;left:" + (box.left + window.scrollX) + "px;top:" + (box.bottom + window.scrollY) + "px;min-width:" + box.width + "px";
      ["Male", "Female", "No Preference"].forEach(function (text) {
        var li = document.createElement("li");
        li.setAttribute("role", "option");
        li.style.cssText = "padding:6px;cursor:pointer";
        li.textContent = text;
        li.addEventListener("click", function () { S.gender = text; log("gender:" + text); ul.remove(); go(BASE + "manageemployees"); });
        ul.appendChild(li);
      });
      document.body.appendChild(ul);
    }
    openList(); // open when the question appears
    input.addEventListener("click", function () { if (document.querySelector("[data-list]")) document.querySelectorAll("[data-list]").forEach(function (el) { el.remove(); }); else openList(); });
  }

  function manage() {
    drawer("<p>Does this position manage other employees?</p>" + boxWithArrow("manageEmployees", "Yes or No", S.manage));
    submitOnArrow("manageEmployees", function (value) { S.manage = value; go(BASE + "otherrequirements"); });
  }

  function other() {
    drawer('<p>Are there any other requirements?</p><textarea name="otherRequirements" placeholder="For Example: Atleast 5 years of experience." style="width:100%;height:90px"></textarea><div><button id="go" disabled>Continue</button></div>');
    var area = root.querySelector("textarea");
    var go1 = root.querySelector("#go");
    area.value = S.other;
    area.addEventListener("input", function () { S.other = area.value; go1.disabled = !area.value.trim(); });
    go1.addEventListener("click", function () { log("click:Continue"); go(BASE + "cityid"); });
  }

  function city() {
    drawer('<p>Which city is this position based in?</p><div class="MuiInputBase-root" style="border:1px solid #333;border-radius:20px;padding:6px 12px">' +
      (S.city ? '<div class="MuiChip-root" style="display:inline-block;background:#eee;padding:2px 8px">' + esc(S.city) + " x</div> " : "") +
      '<input name="cityId" role="combobox" placeholder="Enter City" style="border:0;outline:0"></div>' +
      '<div style="margin-top:10px">' + ["On-Site", "Hybrid", "Remote"].map(function (w) { return '<div class="MuiChip-root wp" style="display:inline-block;margin-right:6px;padding:4px 10px;border:1px solid #333;border-radius:14px;cursor:pointer;' + (S.workplace === w ? "background:#000;color:#fff" : "") + '">' + w + "</div>"; }).join("") + "</div>" +
      '<div><button id="go" ' + (S.city ? "" : "disabled") + ">Continue</button></div>");
    var input = root.querySelector('[name="cityId"]');
    input.addEventListener("input", function () {
      document.querySelectorAll("[data-list]").forEach(function (el) { el.remove(); });
      var typed = input.value.trim();
      if (typed.length < 2) return;
      var ul = document.createElement("ul");
      ul.setAttribute("role", "listbox");
      ul.setAttribute("data-list", "1");
      var box = input.getBoundingClientRect();
      ul.style.cssText = "position:absolute;z-index:60;background:#fff;border:1px solid #888;list-style:none;margin:0;padding:4px;left:" + (box.left + window.scrollX) + "px;top:" + (box.bottom + window.scrollY) + "px;min-width:240px";
      ul.innerHTML = "<li>Loading</li>";
      document.body.appendChild(ul);
      setTimeout(function () {
        if (!document.body.contains(ul)) return;
        ul.innerHTML = "";
        (OPT.noCities ? [] : [typed + ", Pakistan", typed + ", USA"]).forEach(function (text) {
          var li = document.createElement("li");
          li.setAttribute("role", "option");
          li.style.cssText = "padding:6px;cursor:pointer";
          li.textContent = text;
          li.addEventListener("click", function () { S.city = text; log("city:" + text); ul.remove(); city(); });
          ul.appendChild(li);
        });
      }, 500);
    });
    root.querySelectorAll(".wp").forEach(function (chip) { chip.addEventListener("click", function () { S.workplace = chip.textContent.trim(); log("workplace:" + S.workplace); city(); }); });
    root.querySelector("#go").addEventListener("click", function () { log("click:Continue"); go(BASE + "maximumbudget"); });
  }

  function budget() {
    drawer("<p>What is the maximum monthly budget for this position?</p>" +
      '<div class="MuiInputBase-root" style="display:flex;border:1px solid #333;border-radius:8px;padding:6px 12px"><div role="combobox">PKR</div><input name="maximumBudget" placeholder="/ Month" style="flex:1;border:0;outline:0"></div>' +
      '<label><input type="checkbox"> Hide salary</label><div><button id="go">Continue</button></div>');
    var input = root.querySelector('[name="maximumBudget"]');
    input.value = S.budget;
    input.addEventListener("input", function () { S.budget = input.value; });
    root.querySelector("#go").addEventListener("click", function () {
      log("click:Continue");
      root.querySelector("#go").disabled = true;
      setTimeout(function () { go("/employer/job/app/159999/description"); showDialog(); }, OPT.slowAi ? 3000 : 900); // the AI writes the draft
    });
  }

  // The draft job page: sections edit in place and save by themselves
  function lines(text) { return String(text).split("\n").filter(function (l) { return l.trim(); }); }
  function money() { var n = Number(String(S.budget).replace(/[^0-9]/g, "")); return n ? "PKR " + n.toLocaleString("en-US") : ""; }
  function section(id, heading, text) {
    return '<div class="sec" data-sec="' + id + '"><div style="font-weight:700">' + heading + ":</div>" +
      (id === "desc" ? '<span class="badge">' + (S.published ? "Live" : "Draft") + "</span>" : "") +
      '<div class="body">' + lines(text).map(function (l) { return "<p>" + esc(l) + "</p>"; }).join("") + "</div></div>";
  }
  function job() {
    document.title = "RozeeGPT | Practice";
    var url = "https://www.rozeegpt.ai/practice-co-" + String(S.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-159999";
    root.innerHTML = banner() + '<div style="display:flex"><section id="doc" style="width:50%;padding:16px;box-sizing:border-box;height:calc(100vh - 30px);overflow:auto">' +
      "<div>Practice Co</div><h1>" + esc(S.title) + "</h1><div>" + url + "</div>" +
      "<div>" + money() + " &bull; Posted Date: Oct 8, 2026 &bull; " + esc(S.city || "Lahore, Pakistan") + " (" + esc(S.workplace) + ")</div>" +
      "<div><button>Download</button> <button>Share</button> <button>Add Screening Questions</button></div>" +
      section("desc", "Description", S.desc) + section("resp", "Responsibilities", S.resp) +
      "<div style=\"font-weight:700\">Cities:</div><div>" + esc(S.city || "Lahore, Pakistan") + " (" + esc(S.workplace) + ")</div>" +
      "<div style=\"font-weight:700\">Experience:</div><div>" + esc(S.years || "1") + " Years</div>" +
      "<div style=\"font-weight:700\">Apply By:</div><div>Nov 08, 2026</div>" +
      "<div style=\"font-weight:700\">Skills: <button aria-label=\"Add skill\">+</button></div>" +
      S.skills.map(function (s) { return "<div>" + esc(s.name) + " <small>" + s.level + "</small></div>"; }).join("") +
      '<div><button id="publish-job" style="width:100%;padding:12px;background:#2563eb;color:#fff;border:0">Publish Job</button></div></section>' +
      '<section style="width:50%;padding:16px">' + (S.published
        ? "<h2>Candidates (0)</h2><p>Your job is live.</p>"
        : '<h2>This job is not published yet.</h2><p>This job is in a draft mode.</p><p>Apply one of your free featured job credit in order to publish a job to start receiving applicants</p><button id="apply-credit">Apply Credit</button>') +
      "</section></div>";
    root.querySelector("#publish-job").addEventListener("click", function () { log("click:Publish Job"); showDialog(); });
    var apply = root.querySelector("#apply-credit");
    if (apply) apply.addEventListener("click", function () { log("click:Apply Credit"); showDialog(); });
    root.querySelectorAll(".sec .body").forEach(function (body) {
      body.addEventListener("click", function () { edit(body.parentElement.getAttribute("data-sec")); });
    });
  }
  function edit(id) {
    var sec = root.querySelector('[data-sec="' + id + '"] .body');
    if (sec.querySelector('[role="textbox"]')) return; // already open: a click inside the box must not reopen it
    var key = id === "desc" ? "desc" : "resp";
    sec.innerHTML = '<div role="textbox" contenteditable="true" aria-label="Rich Text Editor. Editing area: main. Press Alt+0 for help." style="border:1px solid #2563eb;padding:6px;min-height:60px"></div>';
    var editor = sec.firstChild;
    editor.innerText = S[key];
    editor.focus();
    var save = function () { S[key] = editor.innerText; log("saved:" + key); job(); };
    editor.addEventListener("blur", save);
  }

  function showDialog() {
    if (document.getElementById("publish-dialog")) return;
    var d = document.createElement("div");
    d.id = "publish-dialog";
    d.setAttribute("role", "dialog");
    d.style.cssText = "position:fixed;top:80px;left:30%;width:40%;background:#fff;border:2px solid #1e3a8a;padding:20px;z-index:100";
    d.innerHTML = '<button aria-label="Close" id="d-close" style="float:right">x</button><div>INCLUDED WITH YOUR ACCOUNT</div><h2>3 Free Featured Job credits</h2>' +
      '<button id="d-credit" style="display:block;width:100%;margin:6px 0;padding:10px;background:#2563eb;color:#fff;border:0">Post with free Featured Job credit</button>' +
      '<button id="d-upgrade" style="display:block;width:100%;margin:6px 0;padding:10px">Upgrade to Top Job</button><a href="#" id="d-draft">Keep as draft</a>';
    document.body.appendChild(d);
    d.querySelector("#d-close").addEventListener("click", function () { log("click:close dialog"); d.remove(); });
    d.querySelector("#d-draft").addEventListener("click", function (e) { e.preventDefault(); log("click:Keep as draft"); d.remove(); });
    d.querySelector("#d-upgrade").addEventListener("click", function () { log("PAID:Upgrade to Top Job"); window.__paid = true; });
    d.querySelector("#d-credit").addEventListener("click", function () { log("PUBLISH:credit"); S.published = true; window.__published = true; d.remove(); job(); });
  }

  function render() {
    document.querySelectorAll("[data-list],[role=menu]").forEach(function (el) { el.remove(); });
    var p = location.pathname;
    if (/\/employer\/dashboard\/postjob\/jobtitle/.test(p)) jobtitle();
    else if (/chooseskills/.test(p)) skills();
    else if (/\/postjob\/experience/.test(p)) experience();
    else if (/genderpreference/.test(p)) gender();
    else if (/manageemployees/.test(p)) manage();
    else if (/otherrequirements/.test(p)) other();
    else if (/\/postjob\/cityid/.test(p)) city();
    else if (/maximumbudget/.test(p)) budget();
    else if (/^\/employer\/job\/app\//.test(p)) job();
    else if (/^\/employer\/dashboard\/?$/.test(p)) {
      var delay = OPT.dashboardDelayMs === undefined ? 1200 : OPT.dashboardDelayMs;
      if (!window.__splashDone && delay > 0) {
        root.innerHTML = '<div style="background:#000;color:#fff;height:100vh;text-align:center;padding-top:25vh;font:600 28px sans-serif">rozeegpt.ai</div>';
        setTimeout(function () { window.__splashDone = true; if (location.pathname === p) dashboard(); }, delay);
      } else dashboard();
    }
    else root.innerHTML = banner() + "<h1>Audit log</h1><p>Nothing to post here.</p>";
  }
  render();
})();
