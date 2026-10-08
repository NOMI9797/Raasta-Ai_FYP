/* Raasta-AI Poster: what a posting kit may contain, and which pages it may be used on.
 *
 * A kit arrives from a web page (Raasta-AI), so it is treated as untrusted input: it is checked and copied into a
 * new object that holds only the known properties, as plain strings. It is shown with textContent, never as HTML.
 * Loaded as a content script before bridge.js and panel.js, and by the tests.
 */
(function (root) {
  "use strict";

  const PLATFORMS = ["indeed", "rozee"];
  // Pages each platform's kit is offered on. A suffix match: "indeed.com" covers employers.indeed.com and pk.indeed.com
  const HOSTS = { indeed: ["indeed.com"], rozee: ["rozee.pk", "rozeegpt.ai"] };
  const LABELS = { indeed: "Indeed", rozee: "Rozee.pk" };
  const MAX_FIELDS = 20;
  const MAX_VALUE = 8000;
  const MAX_LIFETIME_MS = 4 * 60 * 60 * 1000; // a kit is for now; whatever it claims, it is not kept longer than this

  const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");

  function hostMatches(hostname, suffixes) {
    const host = String(hostname || "").toLowerCase();
    return suffixes.some((suffix) => host === suffix || host.endsWith("." + suffix));
  }

  /** The platform whose kit is offered on a page, from its host name; null when the page is not one of them. */
  function platformForHost(hostname) {
    return PLATFORMS.find((platform) => hostMatches(hostname, HOSTS[platform])) || null;
  }

  function safeEntryUrl(platform, value) {
    try {
      const url = new URL(String(value));
      return url.protocol === "https:" && hostMatches(url.hostname, HOSTS[platform]) ? url.origin + url.pathname : "";
    } catch (e) {
      return "";
    }
  }

  function isExpired(kit, now) {
    return !(new Date(kit.expiresAt).getTime() > (now === undefined ? Date.now() : now));
  }

  /**
   * Check a kit and return { ok: true, kit } with a clean copy, or { ok: false, error }.
   */
  function validate(input, now) {
    const current = now === undefined ? Date.now() : now;
    if (!input || typeof input !== "object") return { ok: false, error: "The kit is empty." };
    if (input.version !== 1) return { ok: false, error: "This kit is from a different version of Raasta-AI." };
    if (!PLATFORMS.includes(input.platform)) return { ok: false, error: "This platform is not supported." };
    if (!Array.isArray(input.fields) || input.fields.length === 0) return { ok: false, error: "The kit has no fields." };

    const created = new Date(input.createdAt).getTime();
    const expires = new Date(input.expiresAt).getTime();
    if (!Number.isFinite(created) || !Number.isFinite(expires)) return { ok: false, error: "The kit has no valid dates." };
    if (expires <= current) return { ok: false, error: "The kit has expired. Send it again from Raasta-AI." };

    const fields = input.fields
      .slice(0, MAX_FIELDS)
      .map((field) => ({
        key: text(field && field.key, 40).replace(/[^a-zA-Z0-9_]/g, ""),
        label: text(field && field.label, 60),
        value: text(field && field.value, MAX_VALUE),
      }))
      .filter((field) => field.key && field.label && field.value);
    if (fields.length === 0) return { ok: false, error: "The kit has no usable fields." };

    return {
      ok: true,
      kit: {
        version: 1,
        jobId: text(input.jobId, 64),
        platform: input.platform,
        platformLabel: LABELS[input.platform],
        jobTitle: text(input.jobTitle, 200),
        place: text(input.place, 200),
        entryUrl: safeEntryUrl(input.platform, input.entryUrl),
        createdAt: new Date(created).toISOString(),
        expiresAt: new Date(Math.min(expires, current + MAX_LIFETIME_MS)).toISOString(),
        fields: fields,
      },
    };
  }

  root.RaastaPosterKit = { PLATFORMS: PLATFORMS, HOSTS: HOSTS, validate: validate, isExpired: isExpired, platformForHost: platformForHost, safeEntryUrl: safeEntryUrl };
})(globalThis);
