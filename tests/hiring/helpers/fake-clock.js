// Deterministic timers for loop tests: deps.now / setTimeout / clearTimeout / setInterval.
export function settle(rounds = 20) {
  let p = Promise.resolve();
  for (let i = 0; i < rounds; i += 1) p = p.then(() => new Promise((resolve) => setImmediate(resolve)));
  return p;
}

export function createFakeClock(start = Date.parse("2026-01-01T10:00:00Z")) {
  let now = start;
  let nextId = 1;
  const timers = new Map(); // id -> { at, fn, every }

  const clock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + Math.max(0, ms || 0), fn });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn, every: ms });
      return id;
    },
    clearInterval: (id) => timers.delete(id),
    pending: () => timers.size,
    /** Move time forward, firing due timers in order and letting promises settle between them. */
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        let dueId = null;
        let due = null;
        for (const [id, t] of timers) if (t.at <= target && (!due || t.at < due.at)) [dueId, due] = [id, t];
        if (!due) break;
        now = Math.max(now, due.at);
        if (due.every) due.at += due.every;
        else timers.delete(dueId);
        due.fn();
        await settle();
      }
      now = target;
      await settle();
    },
  };
  return clock;
}
