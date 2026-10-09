// Input that behaves like a person at a keyboard and mouse: uneven key timing, longer pauses after words and punctuation,
// the odd slip that gets corrected, and a mouse that travels along a curve instead of jumping. The posting engine
// (libs/poster/runner.js) uses it for every key and click, in a visible browser window. Owner decision 2026-10-07:
// human-like input is allowed on the platforms (docs/ai-hiring/19, section 5f).
// Everything random and every wait is injectable, so the timing rules are tested without a browser.
// Relative imports only (also used by the engine process).
import { READ_VALUE } from "./page-tools";

// Timings in milliseconds. "natural" is the default; "fast" keeps the shape but shortens every wait; "off" does not wait
// (tests, and a way to switch the pacing off in a rehearsal on a machine you trust).
export const SPEEDS = Object.freeze({
  natural: { key: [55, 150], word: 1.45, punctuation: 1.9, newline: 2.6, think: [350, 900], thinkEvery: [45, 95], mouseStep: [5, 14], hold: [40, 120], beforeClick: [70, 220], settle: [250, 700], typoRate: 0.012 },
  fast: { key: [18, 55], word: 1.3, punctuation: 1.5, newline: 1.8, think: [80, 220], thinkEvery: [80, 160], mouseStep: [2, 6], hold: [25, 70], beforeClick: [30, 90], settle: [80, 200], typoRate: 0.004 },
  off: { key: [0, 0], word: 1, punctuation: 1, newline: 1, think: [0, 0], thinkEvery: [1e9, 1e9], mouseStep: [0, 0], hold: [0, 0], beforeClick: [0, 0], settle: [0, 0], typoRate: 0 },
});

// Whether another element, not part of the target, is on top at a point of the page. Built with new Function, see page-tools.
// Only something fixed or sticky to the window counts as covering (a cookie banner): an element drawn over a control by the page itself,
// a label or a styled box, is part of that control, and a click on it is the control's own.
const FIXED_OVER = "const fixed = (n) => { for (let e = n; e && e !== document.documentElement; e = e.parentElement) { const p = getComputedStyle(e).position; if (p === 'fixed' || p === 'sticky') return true; } return false; };";
const COVERED = new Function("el", "p", FIXED_OVER + "const top = document.elementFromPoint(p.x, p.y); return Boolean(top) && !el.contains(top) && !top.contains(el) && fixed(top)");
// A spot inside the element that nothing fixed covers: where the click can go when only part of the element is under a banner
const CLEAR_SPOT = new Function("el", FIXED_OVER + "const r = el.getBoundingClientRect(); for (const fy of [0.5, 0.25, 0.75, 0.1, 0.9]) for (const fx of [0.5, 0.3, 0.7, 0.15, 0.85]) { const x = r.left + r.width * fx; const y = r.top + r.height * fy; const t = document.elementFromPoint(x, y); if (t && (el.contains(t) || t.contains(el) || !fixed(t))) return { x, y }; } return null");
const CENTER = new Function("el", "el.scrollIntoView({ block: 'center', inline: 'nearest' })");
const covered = (target, x, y) => (typeof target.evaluate === "function" ? target.evaluate(COVERED, { x, y }).catch(() => false) : Promise.resolve(false));

export function speedFrom(value) {
  const name = String(value || "").trim().toLowerCase();
  return SPEEDS[name] ? name : "natural";
}

const NEIGHBOURS = {
  a: "qwsz", b: "vghn", c: "xdfv", d: "serfcx", e: "wsdr", f: "drtgvc", g: "ftyhbv", h: "gyujnb", i: "ujko", j: "huikmn",
  k: "jiolm", l: "kop", m: "njk", n: "bhjm", o: "iklp", p: "ol", q: "wa", r: "edft", s: "awedxz", t: "rfgy",
  u: "yhji", v: "cfgb", w: "qase", x: "zsdc", y: "tghu", z: "asx",
};

const between = (rng, [low, high]) => low + (high - low) * rng();
// The average of two draws bunches values toward the middle, like real key intervals
const typical = (rng, range) => (between(rng, range) + between(rng, range)) / 2;

/** How long to wait after typing `char` (the character that came before it is `previous`). */
export function keyDelay(char, previous, speed, rng = Math.random) {
  const profile = SPEEDS[speed] || SPEEDS.natural;
  let delay = typical(rng, profile.key);
  if (char === "\n") delay *= profile.newline;
  else if (/[.,;:!?]/.test(char)) delay *= profile.punctuation;
  else if (char === " ") delay *= profile.word;
  else if (previous && previous === char) delay *= 0.8; // a repeated key is quick
  else if (/[A-Z]/.test(char)) delay *= 1.25; // reaching for Shift
  return delay;
}

/** A key next to `char` on a QWERTY keyboard (what a slipping finger would hit), or null for a key with no neighbours. */
export function slipFor(char, rng = Math.random) {
  const near = NEIGHBOURS[String(char).toLowerCase()];
  if (!near) return null;
  const slip = near[Math.floor(rng() * near.length)];
  return char === char.toUpperCase() && char !== char.toLowerCase() ? slip.toUpperCase() : slip;
}

/** The time `text` takes to type at a speed, without the pauses to think (used to fit a time budget). */
export function estimateTypingMs(text, speed) {
  const profile = SPEEDS[speed] || SPEEDS.natural;
  const mean = (profile.key[0] + profile.key[1]) / 2;
  const chars = Array.from(String(text || ""));
  const extras = chars.filter((c) => c === " ").length * (profile.word - 1) * mean
    + chars.filter((c) => /[.,;:!?]/.test(c)).length * (profile.punctuation - 1) * mean
    + chars.filter((c) => c === "\n").length * (profile.newline - 1) * mean;
  return chars.length * mean + extras;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `speed`: natural | fast | off. `rng` and `sleep` are injectable. A person is also not in two places at once, so a
 * Human is made per browser window and remembers where its mouse pointer is.
 */
export function createHuman({ speed = "natural", rng = Math.random, sleep = defaultSleep } = {}) {
  const name = SPEEDS[speed] ? speed : "natural";
  const profile = SPEEDS[name];
  const pointer = { x: 120 + rng() * 300, y: 120 + rng() * 200 };
  const wait = (ms) => (ms > 0 ? sleep(Math.round(ms)) : Promise.resolve());

  const human = {
    speed: name,
    pointer,
    sleep: wait,

    /** A pause of a random length inside [low, high] ms, scaled to the speed (nothing when the speed is "off"). */
    async pause(low, high) {
      if (name === "off") return;
      const scale = name === "fast" ? 0.3 : 1;
      await wait(between(rng, [low, high]) * scale);
    },

    /** The short settle after something changes on the page, before the next thing is touched. */
    async settle() {
      await wait(between(rng, profile.settle));
    },

    /** A longer pause, as when reading what is on the screen. */
    async think() {
      await wait(between(rng, profile.think) * 1.6);
    },

    /** Moves the pointer to (x, y) along a curve. Returns the points visited. */
    async moveMouse(page, x, y) {
      const from = { ...pointer };
      const distance = Math.hypot(x - from.x, y - from.y);
      const steps = name === "off" ? 1 : Math.max(6, Math.min(40, Math.round(distance / between(rng, [18, 30]))));
      // One bend in the path: a control point pushed to the side of the straight line
      const side = (rng() - 0.5) * Math.min(160, distance * 0.35);
      const control = { x: (from.x + x) / 2 + side * (y - from.y) / (distance || 1), y: (from.y + y) / 2 - side * (x - from.x) / (distance || 1) };
      const visited = [];
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        const eased = t * t * (3 - 2 * t); // slow at both ends, fast in the middle
        const px = (1 - eased) ** 2 * from.x + 2 * (1 - eased) * eased * control.x + eased ** 2 * x;
        const py = (1 - eased) ** 2 * from.y + 2 * (1 - eased) * eased * control.y + eased ** 2 * y;
        await page.mouse.move(px, py);
        visited.push({ x: px, y: py });
        await wait(between(rng, profile.mouseStep));
      }
      pointer.x = x;
      pointer.y = y;
      return visited;
    },

    /** Scrolls the element into view, travels to a spot inside it (not its exact middle) and clicks. */
    async click(page, target) {
      await target.scrollIntoViewIfNeeded();
      let x = 0;
      let y = 0;
      // A cookie banner fixed to the bottom of the window may sit on the spot: a click there would land on the banner. First the part of the
      // element that is in the clear is used (a box half under the banner is still clicked on its visible half, as before); if none is,
      // the element is brought to the middle of the window, where nothing is fixed, and looked at again.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const box = await target.boundingBox();
        if (!box) throw new Error("The element to click has no position on the page");
        x = box.x + box.width * between(rng, [0.3, 0.7]);
        y = box.y + box.height * between(rng, [0.35, 0.65]);
        if (!(await covered(target, x, y))) break;
        const spot = typeof target.evaluate === "function" ? await target.evaluate(CLEAR_SPOT).catch(() => null) : null;
        if (spot) {
          x = spot.x;
          y = spot.y;
          break;
        }
        await target.evaluate(CENTER).catch(() => {});
        await wait(between(rng, [120, 260]) * (name === "off" ? 0 : 1));
      }
      await human.moveMouse(page, x, y);
      await wait(between(rng, profile.beforeClick));
      // A last look before pressing: the page may have moved while the pointer travelled (seen in a real Chrome window, where the press
      // landed on the banner). If something still covers the spot, Playwright finds one that receives the click.
      if (await covered(target, x, y)) {
        // Never press blindly: the thing on top could be a consent button
        await target.click({ timeout: 5000 }).catch(() => { throw new Error("Something covers the element to click and it could not be scrolled clear"); });
        return;
      }
      await page.mouse.down();
      await wait(between(rng, profile.hold));
      await page.mouse.up();
    },

    /**
     * Types text one key at a time. `budgetMs` caps the whole thing: a long text is typed faster rather than taking
     * minutes. `typos` lets the occasional slip happen and be corrected (short boxes only).
     */
    async typeText(page, text, { budgetMs = 0, typos = false } = {}) {
      const chars = Array.from(String(text || ""));
      const estimate = estimateTypingMs(chars.join(""), name);
      const scale = budgetMs > 0 && estimate > budgetMs ? budgetMs / estimate : 1;
      let untilThink = Math.round(between(rng, profile.thinkEvery));
      let previous = "";
      for (let i = 0; i < chars.length; i += 1) {
        const char = chars[i];
        const slip = typos && i > 2 && i < chars.length - 1 && rng() < profile.typoRate ? slipFor(char, rng) : null;
        if (slip) {
          await page.keyboard.type(slip);
          await wait(keyDelay(slip, previous, name, rng) * 1.6 * scale); // a beat to notice
          await page.keyboard.press("Backspace");
          await wait(keyDelay("a", "", name, rng) * scale);
        }
        if (char === "\n") await page.keyboard.press("Enter");
        else await page.keyboard.type(char);
        await wait(keyDelay(char, previous, name, rng) * scale);
        previous = char;
        untilThink -= 1;
        if (untilThink <= 0) {
          untilThink = Math.round(between(rng, profile.thinkEvery));
          await wait(between(rng, profile.think) * scale);
        }
      }
    },

    /** Clicks into a box, clears what is in it (select all, delete) if anything is, and types the text. */
    async fillIn(page, target, text, options = {}) {
      await human.click(page, target);
      const current = await target.evaluate(READ_VALUE).catch(() => "");
      if (String(current).trim()) {
        await page.keyboard.press("ControlOrMeta+A");
        await wait(between(rng, [60, 160]) * (name === "off" ? 0 : 1));
        await page.keyboard.press("Backspace");
      }
      await human.typeText(page, text, options);
    },

    /** A small scroll down and back, as when glancing at a page that has just opened. */
    async glance(page) {
      if (name === "off" || rng() > 0.4) return;
      await page.mouse.wheel(0, 90 + rng() * 110);
      await wait(between(rng, [250, 600]));
      await page.mouse.wheel(0, -(90 + rng() * 110));
    },
  };
  return human;
}
