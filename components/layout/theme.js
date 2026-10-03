// DaisyUI theme shared by the top bar toggle and the Settings page.
// Stored in localStorage; a window event keeps every open control in sync.
export const LIGHT_THEME = "reachly";
export const DARK_THEME = "reachly-dark";
const STORAGE_KEY = "theme";
const EVENT = "raasta:theme";

export function getTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) || LIGHT_THEME;
  } catch {
    return LIGHT_THEME;
  }
}

export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

export function setTheme(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // storage blocked: still apply for this page view
  }
  applyTheme(theme);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: theme }));
}

export function onThemeChange(callback) {
  const handler = (e) => callback(e.detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
