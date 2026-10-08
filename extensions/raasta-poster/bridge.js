/* Raasta-AI Poster: the link between the Raasta-AI page and this extension.
 *
 * Runs on the Raasta-AI site only (see manifest.json). The page and this script talk through window.postMessage,
 * and only to each other: messages from other windows or other origins are ignored. What passes is a posting kit
 * (job text for a platform) one way, and "the person says they posted it" the other. No account, session or
 * credential is involved on either side.
 *
 * Page -> extension: hello | kit | poll | ack          Extension -> page: ready | stored | confirmations | acked | error
 */
(function () {
  "use strict";
  const NS = "raasta-poster";
  const KIT = globalThis.RaastaPosterKit;

  function reply(type, id, payload) {
    window.postMessage(Object.assign({ ns: NS, from: "extension", type: type, id: id }, payload), window.location.origin);
  }

  async function confirmations() {
    const stored = await chrome.storage.local.get("confirmations");
    return Array.isArray(stored.confirmations) ? stored.confirmations : [];
  }

  async function handle(message) {
    switch (message.type) {
      case "hello":
        return reply("ready", message.id, { version: chrome.runtime.getManifest().version, platforms: KIT.PLATFORMS });
      case "kit": {
        const checked = KIT.validate(message.kit);
        if (!checked.ok) return reply("error", message.id, { error: checked.error });
        await chrome.storage.local.set({ ["kit:" + checked.kit.platform]: checked.kit });
        return reply("stored", message.id, { platform: checked.kit.platform, jobId: checked.kit.jobId });
      }
      case "poll":
        return reply("confirmations", message.id, { items: await confirmations() });
      case "ack": {
        const done = new Set(Array.isArray(message.ids) ? message.ids.map(String) : []);
        const left = (await confirmations()).filter((item) => !done.has(item.id));
        await chrome.storage.local.set({ confirmations: left });
        return reply("acked", message.id, {});
      }
      default:
        return undefined;
    }
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (!message || message.ns !== NS || message.from !== "page") return;
    handle(message).catch((error) => {
      // After the extension is reloaded the old page can no longer reach it: say so instead of failing silently
      reply("error", message.id, { error: String((error && error.message) || error).slice(0, 200) });
    });
  });
})();
