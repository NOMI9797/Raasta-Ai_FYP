/**
 * The script the debug recorder runs inside a page to describe it (libs/indeed-debug.js).
 *
 * It is a plain string on purpose. A function passed to page.evaluate is serialised from the compiled source, and
 * the TypeScript/esbuild step injects helpers into it (`__name`) that do not exist in the page, so it throws there.
 * A string reaches the page exactly as written. Keep it free of template literals and of anything the page
 * could not run on its own.
 *
 * It describes what is on the page without reading anything private: no field values, and no hrefs with their
 * query strings. Each interactive element carries a `hint`, the most stable selector that identifies it.
 */
export const DESCRIBE_PAGE_SCRIPT = String.raw`(() => {
  const clean = (text, max) => String(text || "").replace(/\s+/g, " ").trim().slice(0, max || 100);
  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) !== 0;
  };
  const safeHref = (el) => {
    const raw = el.getAttribute("href");
    if (!raw) return null;
    try {
      const url = new URL(raw, location.href);
      const names = Array.from(url.searchParams.keys());
      return url.origin + url.pathname + (names.length ? "?" + names.join("&") : "");
    } catch (e) {
      return clean(raw, 80).split("?")[0];
    }
  };
  const testAttrs = ["data-testid", "data-test", "data-tn-element", "data-automation", "data-cy"];
  const hint = (el) => {
    const tag = el.tagName.toLowerCase();
    for (const attr of testAttrs) {
      const value = el.getAttribute(attr);
      if (value) return "[" + attr + "=\"" + value + "\"]";
    }
    const id = el.getAttribute("id");
    if (id && !/\d{4,}|:/.test(id)) return "#" + id;
    const name = el.getAttribute("name");
    if (name) return tag + "[name=\"" + name + "\"]";
    const aria = el.getAttribute("aria-label");
    if (aria) return tag + "[aria-label=\"" + clean(aria, 60) + "\"]";
    const text = clean(el.innerText, 50);
    return text ? (el.getAttribute("role") || tag) + " \"" + text + "\"" : tag;
  };
  const labelOf = (el) => {
    const labelled = el.getAttribute("aria-labelledby");
    if (labelled) {
      const joined = labelled.split(/\s+/).map((id) => (document.getElementById(id) || {}).innerText || "").join(" ");
      if (clean(joined)) return clean(joined);
    }
    if (el.labels && el.labels[0]) return clean(el.labels[0].innerText);
    return null;
  };
  const collect = (selector, limit, map) =>
    Array.from(document.querySelectorAll(selector)).filter(isVisible).slice(0, limit).map(map);

  const buttons = collect('button, [role="button"], input[type="submit"], input[type="button"]', 60, (el) => ({
    text: clean(el.innerText || el.value),
    ariaLabel: el.getAttribute("aria-label"),
    id: el.getAttribute("id"),
    type: el.getAttribute("type"),
    disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true",
    hint: hint(el),
  }));
  const links = collect("a[href]", 80, (el) => ({
    text: clean(el.innerText),
    ariaLabel: el.getAttribute("aria-label"),
    href: safeHref(el),
    hint: hint(el),
  }));
  const fields = collect(
    'input:not([type="hidden"]), textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="checkbox"], [role="radio"], [role="switch"]',
    60,
    (el) => {
      const type = el.getAttribute("type");
      return {
        tag: el.tagName.toLowerCase(),
        type,
        role: el.getAttribute("role"),
        name: el.getAttribute("name"),
        id: el.getAttribute("id"),
        placeholder: el.getAttribute("placeholder"),
        ariaLabel: el.getAttribute("aria-label"),
        label: labelOf(el),
        required: el.required === true || el.getAttribute("aria-required") === "true",
        disabled: el.disabled === true,
        // the length says whether it is filled; the value itself is never read
        filled: type === "password" ? undefined : typeof el.value === "string" ? el.value.length > 0 : undefined,
        hint: hint(el),
      };
    }
  );
  const dialogs = collect('[role="dialog"], dialog[open]', 5, (el) => ({
    label: el.getAttribute("aria-label"),
    heading: clean((el.querySelector("h1, h2, h3") || {}).innerText),
    text: clean(el.innerText, 300),
  }));

  return {
    url: location.origin + location.pathname,
    title: document.title,
    headings: collect("h1, h2, h3", 30, (el) => el.tagName.toLowerCase() + ": " + clean(el.innerText)),
    buttons,
    links,
    fields,
    dialogs,
    iframes: Array.from(document.querySelectorAll("iframe")).slice(0, 10).map((el) => ({ title: el.getAttribute("title"), src: (el.getAttribute("src") || "").split("?")[0] })),
    textSample: clean(document.body ? document.body.innerText : "", 800),
  };
})()`;
