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
