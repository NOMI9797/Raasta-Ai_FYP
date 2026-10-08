// Meeting records: times offered to a lead, confirmed calls, and their outcome.
// Relative imports only (the agent books meetings from the worker).
import { randomUUID } from "crypto";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "../../db";
import { meetings } from "../../schema";
import { buildIcs } from "./ics";
import { freeSlots, isSlotFree, pickOffer } from "./slots";

export const MEETING_STATUS = {
  PROPOSED: "proposed",
  CONFIRMED: "confirmed",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  NO_SHOW: "no_show",
};
export const OPEN_MEETING_STATUSES = [MEETING_STATUS.PROPOSED, MEETING_STATUS.CONFIRMED];
const MINUTE = 60 * 1000;

/** Confirmed meetings from now on, as busy times. */
export async function busyTimes(userId, { database = db, now = new Date(), exceptLeadId = null } = {}) {
  const rows = await database.select({ leadId: meetings.leadId, start: meetings.startAt, end: meetings.endAt }).from(meetings)
    .where(and(eq(meetings.userId, userId), eq(meetings.status, MEETING_STATUS.CONFIRMED), gte(meetings.endAt, now)));
  return rows.filter((r) => r.start && r.end && r.leadId !== exceptLeadId);
}

function slotOptions(settings, busy, now) {
  return {
    availability: settings.availability,
    timeZone: settings.timezone,
    meetingMinutes: settings.meetingMinutes,
    bufferMinutes: settings.bufferMinutes,
    minNoticeHours: settings.minNoticeHours,
    busy,
    now,
  };
}

/** Three times to offer this lead. */
export async function offerSlots({ userId, leadId, settings, count = 3 }, { database = db, now = new Date() } = {}) {
  const busy = await busyTimes(userId, { database, now, exceptLeadId: leadId });
  return pickOffer(freeSlots({ ...slotOptions(settings, busy, now), horizonDays: 14 }), { count, timeZone: settings.timezone });
}

export async function canBook({ userId, leadId, start, settings }, { database = db, now = new Date() } = {}) {
  const busy = await busyTimes(userId, { database, now, exceptLeadId: leadId });
  return isSlotFree(start, slotOptions(settings, busy, now));
}

/** The lead's open meeting (offered or confirmed), newest first, or null. */
export async function openMeetingFor(leadId, { database = db } = {}) {
  const [row] = await database.select().from(meetings)
    .where(and(eq(meetings.leadId, leadId), inArray(meetings.status, OPEN_MEETING_STATUSES)))
    .orderBy(desc(meetings.createdAt)).limit(1);
  return row || null;
}

/** Record the times we offered (one open meeting per lead). */
export async function proposeMeeting({ lead, slots, settings, attendee, conversationMessageId = null }, { database = db, now = new Date() } = {}) {
  const proposedSlots = slots.map((s) => ({ start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString() }));
  const open = await openMeetingFor(lead.id, { database });
  const values = {
    status: MEETING_STATUS.PROPOSED,
    proposedSlots,
    attendeeName: attendee?.name || open?.attendeeName || null,
    attendeeEmail: attendee?.email || open?.attendeeEmail || null,
    conversationMessageId,
    updatedAt: now,
  };
  if (open) {
    // Re-offering after a confirmed time is a reschedule: the old time is freed
    const [row] = await database.update(meetings).set(values).where(eq(meetings.id, open.id)).returning();
    return row;
  }
  const [row] = await database.insert(meetings).values({
    ...values,
    userId: lead.userId,
    leadId: lead.id,
    campaignId: lead.campaignId,
    title: meetingTitle(settings, lead),
    timezone: settings.timezone,
    location: settings.meetingLink || null,
    createdAt: now,
  }).returning();
  return row;
}

export function meetingTitle(settings, lead) {
  const who = lead.company || lead.name;
  return `${settings.meetingTitle || "Discovery call"}${who ? `: ${who}` : ""}`;
}

/** Book a time: the lead's open meeting becomes confirmed (a changed time bumps the invite's sequence). */
export async function confirmMeeting({ lead, start, settings, attendee, conversationMessageId = null, bookedBy = "agent" }, { database = db, now = new Date() } = {}) {
  const startAt = new Date(start);
  const endAt = new Date(startAt.getTime() + settings.meetingMinutes * MINUTE);
  const open = await openMeetingFor(lead.id, { database });
  const values = {
    status: MEETING_STATUS.CONFIRMED,
    startAt,
    endAt,
    timezone: settings.timezone,
    location: settings.meetingLink || open?.location || null,
    attendeeName: attendee?.name || open?.attendeeName || null,
    attendeeEmail: attendee?.email || open?.attendeeEmail || null,
    bookedBy,
    conversationMessageId: conversationMessageId || open?.conversationMessageId || null,
    updatedAt: now,
  };
  if (open) {
    const moved = open.status === MEETING_STATUS.CONFIRMED && open.startAt?.getTime() !== startAt.getTime();
    const [row] = await database.update(meetings).set({
      ...values,
      icsUid: open.icsUid || `${randomUUID()}@raasta-ai`,
      icsSequence: (open.icsSequence || 0) + (moved ? 1 : 0),
    }).where(eq(meetings.id, open.id)).returning();
    return row;
  }
  const [row] = await database.insert(meetings).values({
    ...values,
    userId: lead.userId,
    leadId: lead.id,
    campaignId: lead.campaignId,
    title: meetingTitle(settings, lead),
    icsUid: `${randomUUID()}@raasta-ai`,
    createdAt: now,
  }).returning();
  return row;
}

/** The calendar invite for a confirmed (or cancelled) meeting. */
export function meetingInvite(meeting, { organizer, description, method = "REQUEST" }) {
  return {
    method,
    content: buildIcs({
      uid: meeting.icsUid,
      sequence: meeting.icsSequence || 0,
      start: meeting.startAt,
      end: meeting.endAt,
      title: meeting.title,
      description,
      location: meeting.location,
      organizer,
      attendee: meeting.attendeeEmail ? { name: meeting.attendeeName, email: meeting.attendeeEmail } : null,
      method,
    }),
  };
}

export async function listMeetings({ userId, isAdmin = false }, { database = db } = {}) {
  const query = database.select().from(meetings);
  return (isAdmin ? query : query.where(eq(meetings.userId, userId))).orderBy(desc(meetings.updatedAt));
}

export async function listMeetingsForLead(leadId, { database = db } = {}) {
  return database.select().from(meetings).where(eq(meetings.leadId, leadId)).orderBy(desc(meetings.createdAt));
}

/**
 * The person updates a meeting: mark it held / no-show, add notes, or cancel it. Cancelling a
 * confirmed meeting can email the client (with a calendar cancellation) in the same thread.
 */
export async function updateMeeting(meeting, { status, notes, outcome }, { database = db, now = new Date() } = {}) {
  const changes = { updatedAt: now };
  if (status !== undefined) {
    if (!Object.values(MEETING_STATUS).includes(status)) throw new Error("Unknown meeting status");
    changes.status = status;
    if (status === MEETING_STATUS.CANCELLED) changes.icsSequence = (meeting.icsSequence || 0) + 1;
  }
  if (notes !== undefined) changes.notes = String(notes || "").slice(0, 5000) || null;
  if (outcome !== undefined) changes.outcome = String(outcome || "").slice(0, 500) || null;
  const [row] = await database.update(meetings).set(changes).where(eq(meetings.id, meeting.id)).returning();
  return row;
}
