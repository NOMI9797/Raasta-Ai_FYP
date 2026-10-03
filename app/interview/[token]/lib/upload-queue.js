// Sequential recording upload queue: retry ×3 with exponential backoff, kept in memory.
// (docs/ai-hiring/10-interview-room.md "Client audio pipeline")

const MAX_RETRIES = 3;

export class UploadQueue {
  constructor(token, { onChange, fetchImpl, sleep } = {}) {
    this.token = token;
    this.items = [];
    this.running = false;
    this.failed = 0;
    this.uploaded = 0;
    this.onChange = onChange || (() => {});
    this.fetch = fetchImpl || ((...args) => fetch(...args));
    this.sleep = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.idle = Promise.resolve();
    this.resolveIdle = null;
  }

  get pending() {
    return this.items.length + (this.running ? 1 : 0);
  }

  add({ kind, part, final = false, blob }) {
    this.items.push({ kind, part, final, blob });
    this.onChange(this.status());
    if (!this.running) this.run();
  }

  status() {
    return { pending: this.pending, uploaded: this.uploaded, failed: this.failed };
  }

  /** Resolves once every queued part is uploaded (or has given up). */
  drain() {
    return this.running || this.items.length ? this.idle : Promise.resolve();
  }

  async run() {
    this.running = true;
    this.idle = new Promise((resolve) => { this.resolveIdle = resolve; });
    while (this.items.length) {
      const item = this.items.shift();
      const ok = await this.uploadWithRetry(item);
      if (ok) this.uploaded += 1;
      else this.failed += 1;
      this.onChange(this.status());
    }
    this.running = false;
    this.onChange(this.status());
    this.resolveIdle?.();
  }

  async uploadWithRetry(item) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const form = new FormData();
        form.append("kind", item.kind);
        form.append("part", String(item.part));
        form.append("final", item.final ? "true" : "false");
        form.append("file", item.blob, `${item.kind}-${item.part}.webm`);
        const res = await this.fetch(`/api/interview/${encodeURIComponent(this.token)}/upload`, { method: "POST", body: form });
        if (res.ok) return true;
        // Client errors other than rate limits won't succeed on retry
        if (res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 408) return false;
      } catch {
        // network error: retry
      }
      if (attempt < MAX_RETRIES) await this.sleep(1000 * 2 ** attempt);
    }
    return false;
  }
}
