/**
 * Shared Playwright helpers used by both LinkedIn and Rozee.pk automation.
 * Centralises anti-detection delays, mouse simulation, screenshot capture,
 * and a tiny pattern-matcher for URL routing in login flows.
 */

export function randomDelay(min = 1000, max = 3000) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function humanLikeDelay(page, min = 1500, max = 4000) {
  const delay = randomDelay(min, max);
  await page.waitForTimeout(delay);
}

export async function simulateHumanBehavior(page) {
  const x = Math.random() * 800 + 200;
  const y = Math.random() * 400 + 200;
  await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10) + 5 });

  if (Math.random() > 0.5) {
    await page.mouse.wheel(0, Math.random() * 200 - 100);
  }

  await page.waitForTimeout(randomDelay(500, 1500));
}

export function urlMatchesPatterns(url, patterns) {
  return patterns.some((pattern) => url.includes(pattern));
}

export async function captureScreenshot(page, label) {
  try {
    const buffer = await page.screenshot({ type: "jpeg", quality: 70, fullPage: false });
    const base64 = buffer.toString("base64");
    const dataUri = `data:image/jpeg;base64,${base64}`;
    return { label, dataUri, url: page.url(), timestamp: new Date().toISOString() };
  } catch (err) {
    return {
      label,
      dataUri: null,
      url: page.url(),
      timestamp: new Date().toISOString(),
      error: err.message,
    };
  }
}

export const DEFAULT_BROWSER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-accelerated-2d-canvas",
  "--no-first-run",
  "--no-zygote",
  "--disable-gpu",
];

/**
 * Launch Chromium with Rozee cookies / storage injected before navigation.
 * Caller must `await browser.close()` when finished.
 */
export async function launchRozeeChromium(sessionData = {}) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    args: DEFAULT_BROWSER_ARGS,
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  if (Array.isArray(sessionData?.cookies) && sessionData.cookies.length) {
    const cleanCookies = sessionData.cookies
      .filter((c) => c?.name && c?.value)
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain || ".rozee.pk",
        path: c.path || "/",
        httpOnly: c.httpOnly ?? false,
        secure: c.secure ?? false,
        sameSite: c.sameSite || "Lax",
        ...(c.expires ? { expires: c.expires } : {}),
      }));
    if (cleanCookies.length) await context.addCookies(cleanCookies);
  }

  if (sessionData?.localStorage && Object.keys(sessionData.localStorage).length) {
    await context.addInitScript((storage) => {
      for (const [k, v] of Object.entries(storage)) {
        try {
          window.localStorage.setItem(k, v);
        } catch {}
      }
    }, sessionData.localStorage);
  }
  if (sessionData?.sessionStorage && Object.keys(sessionData.sessionStorage).length) {
    await context.addInitScript((storage) => {
      for (const [k, v] of Object.entries(storage)) {
        try {
          window.sessionStorage.setItem(k, v);
        } catch {}
      }
    }, sessionData.sessionStorage);
  }

  const page = await context.newPage();
  return { browser, context, page };
}

export async function restoreSessionToContext(context, page, sessionData) {
  if (sessionData?.cookies?.length) {
    await context.addCookies(sessionData.cookies);
  }
  if (sessionData?.localStorage) {
    await page.addInitScript((storage) => {
      Object.keys(storage).forEach((key) => {
        window.localStorage.setItem(key, storage[key]);
      });
    }, sessionData.localStorage);
  }
  if (sessionData?.sessionStorage) {
    await page.addInitScript((storage) => {
      Object.keys(storage).forEach((key) => {
        window.sessionStorage.setItem(key, storage[key]);
      });
    }, sessionData.sessionStorage);
  }
}

export async function captureSessionFromContext(context, page) {
  const cookies = await context.cookies();
  const localStorage = await page.evaluate(() => {
    const storage = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      storage[key] = window.localStorage.getItem(key);
    }
    return storage;
  });
  const sessionStorage = await page.evaluate(() => {
    const storage = {};
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i);
      storage[key] = window.sessionStorage.getItem(key);
    }
    return storage;
  });
  return { cookies, localStorage, sessionStorage };
}
