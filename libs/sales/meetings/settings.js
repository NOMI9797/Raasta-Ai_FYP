// Per-user sales settings with defaults: meeting hours, length and link, follow-up timing, and the
// company name the agent writes as. Relative imports only.
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { kbDocuments, salesSettings } from "../../schema";
import { DEFAULT_FOLLOW_UP_DAYS } from "../conversation/thread";
import { SAMPLE_COMPANY } from "../knowledge/sample";
import { DEFAULT_AVAILABILITY, cleanAvailability, isValidTimeZone } from "./slots";

export const SETTINGS_DEFAULTS = {
  companyName: null,
  timezone: "Asia/Karachi",
  availability: DEFAULT_AVAILABILITY,
  meetingMinutes: 30,
  bufferMinutes: 15,
  minNoticeHours: 24,
  meetingTitle: "Discovery call",
  meetingLink: null,
  followUpDays: DEFAULT_FOLLOW_UP_DAYS,
};

const clampInt = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Validated settings from user input; unknown or bad values fall back to the defaults. */
export function cleanSettings(input = {}) {
  const days = Array.isArray(input.followUpDays) ? input.followUpDays.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n <= 60) : null;
  const link = String(input.meetingLink || "").trim();
  return {
    companyName: String(input.companyName || "").trim().slice(0, 120) || null,
    timezone: isValidTimeZone(input.timezone) ? input.timezone : SETTINGS_DEFAULTS.timezone,
    availability: cleanAvailability(input.availability || DEFAULT_AVAILABILITY),
    meetingMinutes: clampInt(input.meetingMinutes, 15, 120, 30),
    bufferMinutes: clampInt(input.bufferMinutes, 0, 60, 15),
    minNoticeHours: clampInt(input.minNoticeHours, 1, 168, 24),
    meetingTitle: String(input.meetingTitle || "").trim().slice(0, 120) || SETTINGS_DEFAULTS.meetingTitle,
    meetingLink: /^https:\/\/\S+$/.test(link) ? link.slice(0, 500) : null,
    // Increasing and at most three follow-ups
    followUpDays: days ? [...new Set(days)].sort((a, b) => a - b).slice(0, 3) : SETTINGS_DEFAULTS.followUpDays,
  };
}

export async function getSalesSettings(userId, { database = db } = {}) {
  const [row] = await database.select().from(salesSettings).where(eq(salesSettings.userId, userId)).limit(1);
  const merged = { ...SETTINGS_DEFAULTS, ...Object.fromEntries(Object.entries(row || {}).filter(([, v]) => v !== null && v !== undefined)) };
  if (!merged.companyName) {
    // With only the sample knowledge base loaded, write as the sample company
    const [sample] = await database.select({ id: kbDocuments.id }).from(kbDocuments)
      .where(and(eq(kbDocuments.userId, userId), eq(kbDocuments.isSample, true))).limit(1);
    if (sample) merged.companyName = SAMPLE_COMPANY;
  }
  return { ...merged, saved: Boolean(row) };
}

export async function saveSalesSettings(userId, input, { database = db } = {}) {
  const values = { ...cleanSettings(input), updatedAt: new Date() };
  await database.insert(salesSettings).values({ userId, ...values })
    .onConflictDoUpdate({ target: salesSettings.userId, set: values });
  return getSalesSettings(userId, { database });
}
