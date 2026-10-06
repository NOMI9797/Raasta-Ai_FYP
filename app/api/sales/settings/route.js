import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { getSalesSettings, saveSalesSettings } from "@/libs/sales/meetings/settings";
import { freeSlots, pickOffer } from "@/libs/sales/meetings/slots";
import { busyTimes } from "@/libs/sales/meetings/store";

async function withPreview(userId, settings) {
  // The next times the agent would offer, so the person can check their hours are right
  const busy = await busyTimes(userId);
  const slots = pickOffer(freeSlots({ availability: settings.availability, timeZone: settings.timezone, meetingMinutes: settings.meetingMinutes, bufferMinutes: settings.bufferMinutes, minNoticeHours: settings.minNoticeHours, busy, horizonDays: 14 }), { count: 3, timeZone: settings.timezone });
  return { ...settings, preview: slots.map((s) => s.start.toISOString()) };
}

// GET /api/sales/settings — meeting hours, length and link, follow-up timing, company name
export const GET = withAuth(async (request, { user }) => {
  try {
    return NextResponse.json({ success: true, settings: await withPreview(user.id, await getSalesSettings(user.id)) });
  } catch (error) {
    console.error("Sales settings error:", error?.message);
    return NextResponse.json({ error: "Could not load the settings" }, { status: 500 });
  }
}, { requireUser: true });

// PUT /api/sales/settings — save them (values are validated; bad ones fall back to defaults)
export const PUT = withAuth(async (request, { user }) => {
  try {
    const settings = await saveSalesSettings(user.id, await request.json());
    return NextResponse.json({ success: true, settings: await withPreview(user.id, settings) });
  } catch (error) {
    console.error("Save sales settings error:", error?.message);
    return NextResponse.json({ error: "Could not save the settings" }, { status: 500 });
  }
}, { requireUser: true });
