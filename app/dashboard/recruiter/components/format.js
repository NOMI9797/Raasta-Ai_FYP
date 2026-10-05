// Small formatting helpers for the recruiter screens.

/** 83 → "1:23"; 3725 → "1:02:05". Accepts seconds; null/NaN → "–". */
export function formatClock(totalSeconds) {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) return "–";
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Whole minutes for a length in seconds ("12 min"); under a minute → "<1 min". */
export function formatMinutes(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return "–";
  return seconds < 60 ? "<1 min" : `${Math.round(seconds / 60)} min`;
}

export function formatDateTime(value) {
  if (!value) return "–";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "–"
    : date.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function formatPercent(fraction) {
  return fraction == null || !Number.isFinite(fraction) ? "–" : `${Math.round(fraction * 100)}%`;
}

/** "5m ago", "3h ago", "2d ago". */
export function formatAgo(date) {
  const minutes = Math.round((Date.now() - new Date(date)) / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

/** "expires in 70h", "expires in 5d", "expired". */
export function formatUntil(date) {
  const hours = Math.round((new Date(date) - Date.now()) / 3600000);
  if (hours <= 0) return "expired";
  return hours < 48 ? `expires in ${hours}h` : `expires in ${Math.round(hours / 24)}d`;
}
