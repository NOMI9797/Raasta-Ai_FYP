/* Raasta-AI Poster: finding a form field by what it is called, and putting a value in it the way a person typing would.
 *
 * What it does and does not do:
 *  - It only fills text boxes, text areas, drop-downs and rich-text boxes. It never clicks a button, never submits a
 *    form and never moves to another step: the person does that.
 *  - It does not overwrite something the person already typed.
 *  - It finds fields by their visible name (label, aria-label, placeholder, nearby heading), because platforms change
 *    their markup far more often than they change the words on a form. When nothing matches it says so and the person
 *    uses the Copy buttons instead.
 * Loaded as a content script before panel.js, and by the tests.
 */
(function (root) {
  "use strict";

  // What each kit field is called on job forms. Case-insensitive; the first pattern that matches wins.
  const NAMES = {
    title: [/^\s*job title\b/, /\bjob title\b/, /\btitle\b/, /\bposition\b/, /\brole\b/],
    location: [/\bjob location\b/, /\bwork location\b/, /\blocation\b/, /\bcity\b/],
    employmentType: [/\bjob type\b/, /\bemployment type\b/, /\bwork type\b/],
    // A bare "minimum" is only taken when it is the whole label, so "Minimum education" is never filled with a salary
    salaryMin: [/\b(minimum|min)\b.*\b(pay|salary|amount|wage|rate)\b/, /\b(pay|salary|amount|wage|rate)\b.*\b(minimum|min)\b/, /^\s*(minimum|min|from)\s*$/],
    salaryMax: [/\b(maximum|max)\b.*\b(pay|salary|amount|wage|rate)\b/, /\b(pay|salary|amount|wage|rate)\b.*\b(maximum|max)\b/, /^\s*(maximum|max|to)\s*$/],
    salary: [/\bsalary\b/, /\bpay\b/, /\bcompensation\b/],
    description: [/\bjob description\b/, /\bdescription\b/, /\bresponsibilities\b/],
  };
  // Fields this script is willing to fill. Others (skills, the apply link, the workplace type) are copy-only: the
  // platforms render them as chips and custom pickers that a label cannot reliably find.
  const FILLABLE = ["title", "location", "employmentType", "salaryMin", "salaryMax", "salary", "description"];

  const CONTROLS = [
    'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="file"]):not([type="password"]):not([type="image"])',
    "textarea",
    "select",
    '[contenteditable=""]',
    '[contenteditable="true"]',
    '[role="textbox"]',
  ].join(",");

  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  const plain = (value) => String(value || "").replace(/\s+/g, " ").trim(); // the page's own wording, for the report

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  const isRich = (el) => el.isContentEditable || el.getAttribute("role") === "textbox";

  // Whether a person has already put something in the control. A drop-down on its first option is a default, not a choice.
  function valueOf(el) {
    if (isRich(el)) return (el.innerText || el.textContent || "").trim();
    if (el.tagName === "SELECT") return el.selectedIndex > 0 ? String(el.value || "").trim() : "";
    return (el.value || "").trim();
  }

  /** Every name a person could read for a control: its label, aria-label, placeholder, name and the heading before it. */
  function namesOf(el) {
    const doc = el.ownerDocument;
    const names = [];
    const add = (value) => { const v = clean(value); if (v) names.push(v); };

    add(el.getAttribute("aria-label"));
    (el.getAttribute("aria-labelledby") || "").split(/\s+/).forEach((id) => { const ref = id && doc.getElementById(id); if (ref) add(ref.textContent); });
    if (el.labels) Array.prototype.forEach.call(el.labels, (label) => add(label.textContent));
    // A rich-text box is not a "labelable" element, so its <label for> is not in el.labels: look it up by id
    if (el.id && !el.labels) {
      Array.prototype.forEach.call(doc.querySelectorAll("label[for]"), (label) => { if (label.getAttribute("for") === el.id) add(label.textContent); });
    }
    const wrapping = el.closest("label");
    if (wrapping) add(wrapping.textContent);
    add(el.getAttribute("placeholder"));
    add(el.getAttribute("name"));
    add(el.getAttribute("data-testid"));
    if (names.length === 0) {
      // Last resort: the closest heading or label-like text in the group the control sits in
      const group = el.parentElement && el.parentElement.closest("fieldset, [role='group'], section, div");
      const near = group && group.querySelector("legend, label, h1, h2, h3, h4, [class*='label' i]");
      if (near && !near.contains(el)) add(near.textContent);
    }
    return names;
  }

  /** The best control for a kit field, or null. `taken` holds controls already used for another field. */
  function findControl(doc, key, taken) {
    const patterns = NAMES[key] || [];
    let best = null;
    Array.prototype.forEach.call(doc.querySelectorAll(CONTROLS), (el) => {
      if (taken.has(el) || !isVisible(el) || el.disabled || el.readOnly) return;
      const names = namesOf(el);
      for (let rank = 0; rank < patterns.length; rank++) {
        if (names.some((name) => patterns[rank].test(name))) {
          if (!best || rank < best.rank) best = { el: el, rank: rank };
          break;
        }
      }
    });
    return best && best.el;
  }

  function setNative(el, value) {
    const proto = el instanceof el.ownerDocument.defaultView.HTMLTextAreaElement
      ? el.ownerDocument.defaultView.HTMLTextAreaElement.prototype
      : el.ownerDocument.defaultView.HTMLInputElement.prototype;
    // The framework's own setter is bypassed on purpose: assigning el.value directly is ignored by React-style inputs
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setSelect(el, value) {
    const wanted = clean(value);
    const near = (o) => {
      const t = clean(o.textContent);
      return Boolean(wanted && t && (t.includes(wanted) || wanted.includes(t)));
    };
    const option = Array.prototype.find.call(el.options, (o) => clean(o.textContent) === wanted || clean(o.value) === wanted)
      || Array.prototype.find.call(el.options, near);
    if (!option) return false;
    el.value = option.value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function setRich(el, value) {
    const doc = el.ownerDocument;
    el.focus();
    const range = doc.createRange();
    range.selectNodeContents(el);
    const selection = doc.defaultView.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    // execCommand fires the same input events as typing, which the editors listen for
    const lines = String(value).split("\n");
    let ok = true;
    lines.forEach((line, index) => {
      if (index > 0) ok = doc.execCommand("insertParagraph") && ok;
      if (line) ok = doc.execCommand("insertText", false, line) && ok;
    });
    if (!ok) {
      el.textContent = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return true;
  }

  /**
   * Put a value in a control. Returns { filled: boolean, reason?: string }.
   */
  function setValue(el, value) {
    if (el.tagName === "SELECT") return setSelect(el, value) ? { filled: true } : { filled: false, reason: "no matching choice" };
    if (isRich(el)) return setRich(el, value) ? { filled: true } : { filled: false, reason: "could not type into it" };
    setNative(el, value);
    return { filled: true };
  }

  // The description is the biggest and least ambiguous box, so it claims its control first
  const ORDER = ["description"].concat(FILLABLE.filter((key) => key !== "description"));

  // Option controls: tick boxes and radio buttons, such as a row of "Full-time" / "Part-time" chips
  const CHOICES = 'input[type="checkbox"], input[type="radio"], [role="radio"], [role="checkbox"]';

  /** The option whose label is exactly the wanted value, or null. Chip labels often carry a "+" icon as text. */
  function findChoice(doc, value, taken) {
    const wanted = clean(value);
    let found = null;
    Array.prototype.forEach.call(doc.querySelectorAll(CHOICES), (el) => {
      if (found || taken.has(el) || !isVisible(el) || el.disabled) return;
      if (namesOf(el).some((name) => name.replace(/^\+\s*/, "") === wanted)) found = el;
    });
    return found;
  }

  /**
   * Decide, without touching the page, which control each kit field would go into:
   *   [{ key, field, el, kind }]  (el is null when nothing on the page matches; kind is "text" or "choice")
   */
  function plan(doc, kit) {
    const taken = new Set();
    const found = [];
    ORDER.forEach((key) => {
      const field = kit.fields.find((f) => f.key === key);
      if (!field) return;
      let el = findControl(doc, key, taken);
      let kind = "text";
      // The job type is often a row of options rather than a box: choose the one with the same name
      if (!el && key === "employmentType") {
        el = findChoice(doc, field.value, taken);
        kind = "choice";
      }
      if (el) taken.add(el);
      found.push({ key: key, field: field, el: el, kind: el ? kind : null });
    });
    return found;
  }

  /**
   * Fill what can be found. `kit.fields` is [{ key, label, value }]. Returns one result per fillable field:
   *   { key, label, status: "filled" | "kept" | "not_found" | "failed", detail? }
   * "kept" means the box already had text, which is left alone unless `overwrite` is set.
   */
  function fillKit(doc, kit, options) {
    const overwrite = Boolean(options && options.overwrite);
    const results = plan(doc, kit).map((step) => {
      const key = step.key;
      const label = step.field.label;
      if (!step.el) return { key: key, label: label, status: "not_found" };
      if (step.kind === "choice") {
        // Ticking an option is the one thing besides typing that this does; it is never a button that moves on or posts
        if (step.el.checked || step.el.getAttribute("aria-checked") === "true") return { key: key, label: label, status: "kept", detail: "it is already chosen" };
        step.el.click();
        return { key: key, label: label, status: "filled" };
      }
      if (!overwrite && valueOf(step.el)) return { key: key, label: label, status: "kept", detail: "it already has text" };
      const outcome = setValue(step.el, step.field.value);
      return outcome.filled ? { key: key, label: label, status: "filled" } : { key: key, label: label, status: "failed", detail: outcome.reason };
    });
    // Report in the kit's own order
    const position = (key) => kit.fields.findIndex((f) => f.key === key);
    return results.sort((a, b) => position(a.key) - position(b.key));
  }

  const REPORT_CONTROLS = CONTROLS + ', input[type="checkbox"], input[type="radio"], [role="combobox"], [role="checkbox"], [role="radio"], [role="switch"], [role="listbox"]';
  const TEST_ATTRS = ["data-testid", "data-test", "data-tn-element", "data-automation", "data-cy"];

  // The most stable way to point at a control, for whoever has to write or fix a selector from this report
  function hintOf(el) {
    for (let i = 0; i < TEST_ATTRS.length; i++) {
      const value = el.getAttribute(TEST_ATTRS[i]);
      if (value) return "[" + TEST_ATTRS[i] + '="' + value + '"]';
    }
    const id = el.getAttribute("id");
    if (id && !/\d{4,}|:/.test(id)) return "#" + id;
    const name = el.getAttribute("name");
    if (name) return el.tagName.toLowerCase() + '[name="' + name + '"]';
    const aria = el.getAttribute("aria-label");
    return aria ? el.tagName.toLowerCase() + '[aria-label="' + aria.slice(0, 60) + '"]' : el.tagName.toLowerCase();
  }

  /**
   * A description of the page's form for a person to paste to whoever tunes this script: what each box is called
   * (every name Fill can read for it), how to point at it, and which kit field Fill would put in it. It never
   * contains what has been typed (only whether a box is empty), passwords, links, or the query part of the address.
   */
  function report(doc, kit, meta) {
    const wouldFill = new Map();
    const missing = [];
    plan(doc, kit).forEach((step) => { if (step.el) wouldFill.set(step.el, step.key); else missing.push(step.key); });

    const fields = [];
    Array.prototype.forEach.call(doc.querySelectorAll(REPORT_CONTROLS), (el) => {
      if (fields.length >= 80 || !isVisible(el)) return;
      const type = el.getAttribute("type");
      const isToggle = type === "checkbox" || type === "radio" || /^(checkbox|radio|switch)$/.test(el.getAttribute("role") || "");
      fields.push({
        tag: el.tagName.toLowerCase(),
        type: type,
        role: el.getAttribute("role"),
        names: namesOf(el),
        hint: hintOf(el),
        required: el.required === true || el.getAttribute("aria-required") === "true",
        disabled: el.disabled === true,
        filled: type === "password" ? undefined : isToggle ? Boolean(el.checked || el.getAttribute("aria-checked") === "true") : Boolean(valueOf(el)),
        wouldFill: wouldFill.get(el) || null,
      });
    });

    const buttons = [];
    Array.prototype.forEach.call(doc.querySelectorAll('button, [role="button"], input[type="submit"]'), (el) => {
      if (buttons.length >= 40 || !isVisible(el)) return;
      buttons.push({ text: plain(el.innerText || el.value).slice(0, 60), ariaLabel: el.getAttribute("aria-label"), disabled: el.disabled === true, hint: hintOf(el) });
    });

    const view = doc.defaultView;
    return {
      kind: "raasta-poster-page-report",
      version: 1,
      at: new Date().toISOString(),
      platform: kit.platform,
      host: view.location.hostname,
      path: view.location.pathname,
      title: doc.title,
      headings: Array.prototype.filter.call(doc.querySelectorAll("h1, h2, h3"), isVisible).slice(0, 20).map((h) => plain(h.textContent).slice(0, 100)),
      fields: fields,
      kitFieldsWithNoMatch: missing,
      buttons: buttons,
      textSample: plain(doc.body ? doc.body.innerText : "").slice(0, 300),
      extension: meta || null,
    };
  }

  root.RaastaPosterFill = { NAMES: NAMES, FILLABLE: FILLABLE, findControl: findControl, setValue: setValue, plan: plan, fillKit: fillKit, report: report, namesOf: namesOf };
})(globalThis);
