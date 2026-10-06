// Shared set-up for the sales integration tests: a throw-away user with campaigns and leads in the
// real (local) database, fakes for the AI, email and mailbox, and clean-up afterwards.
// Nothing here sends real email or calls the real AI.
import "../../../libs/load-env";
import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../../../libs/db";
import { agentRuns, campaigns, leads, salesSettings, users } from "../../../libs/schema";
import { setLlmClient } from "../../../libs/ai/llm";

/** Is the database reachable? Integration tests skip themselves when it isn't. */
export async function databaseReady() {
  try {
    await Promise.race([db.execute(sql`select 1`), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000))]);
    return true;
  } catch {
    return false;
  }
}

/** Close the database pool so the test process can exit. */
export async function closeDatabase() {
  await globalThis.pgClient?.end({ timeout: 2 }).catch(() => {});
}

/** A fresh sales user (deleted with everything they own by removeUser). */
export async function createUser({ name = "Test Seller" } = {}) {
  const id = `test-sales-${randomUUID()}`;
  await db.insert(users).values({ id, email: `${id}@raasta.test`, name, role: "sales_operator", modes: ["sales"] });
  // Meeting hours Monday-Friday 10:00-18:00 Karachi, 24 hours' notice, no meeting link
  await db.insert(salesSettings).values({
    userId: id,
    companyName: "Test Software House",
    timezone: "Asia/Karachi",
    availability: Object.fromEntries(["mon", "tue", "wed", "thu", "fri"].map((d) => [d, [{ start: "10:00", end: "18:00" }]]).concat([["sat", []], ["sun", []]])),
    meetingMinutes: 30,
    bufferMinutes: 15,
    minNoticeHours: 24,
    meetingTitle: "Discovery call",
    meetingLink: "https://meet.example.com/test-room",
    followUpDays: [3, 7],
  });
  return { id, name, role: "sales_operator" };
}

export async function removeUser(userId) {
  // Cascades to campaigns, leads, messages, runs, actions, threads, meetings, knowledge base
  await db.delete(users).where(eq(users.id, userId));
}

export async function createCampaign(userId, { name = "Test campaign", sources = ["indeed"] } = {}) {
  const [row] = await db.insert(campaigns).values({
    userId, name, sources, status: "active",
    icpConfig: { serviceType: "Dedicated React and Flutter developers" },
  }).returning();
  return row;
}

/** A company lead as Indeed import creates it. */
export async function createCompanyLead(userId, campaignId, { company, jobTitle = "React Developer", sourceData = {}, ...rest }) {
  const [row] = await db.insert(leads).values({
    userId, campaignId, source: "indeed",
    url: `https://www.indeed.com/viewjob?jk=${randomUUID().slice(0, 12)}`,
    name: company, company, title: jobTitle,
    sourceData: { companyKey: company?.toLowerCase(), company: { name: company }, jobs: [{ title: jobTitle }], ...sourceData },
    ...rest,
  }).returning();
  return row;
}

export async function createRun(userId, campaignId, { mode = "assisted", config = {} } = {}) {
  const [row] = await db.insert(agentRuns).values({
    userId, pipelineType: "sales_operator", campaignId, mode, status: "queued", config: { campaignId, ...config },
  }).returning();
  return row;
}

export async function getRun(id) {
  const [row] = await db.select().from(agentRuns).where(eq(agentRuns.id, id));
  return row;
}

export async function getLead(id) {
  const [row] = await db.select().from(leads).where(eq(leads.id, id));
  return row;
}

/** Records every email instead of sending it. */
export function fakeEmail() {
  const sent = [];
  const send = async (email) => {
    const messageId = `<fake-${randomUUID()}@test>`;
    sent.push({ ...email, messageId });
    return { delivered: "fake", to: email.to, intendedTo: email.to, redirected: false, messageId };
  };
  return { send, sent };
}

/** Records notifications instead of storing them. */
export function fakeNotify() {
  const all = [];
  const fn = async (n) => all.push(n);
  return { fn, all };
}

/**
 * A fake AI that answers each prompt type with JSON, so the real prompt building and parsing run.
 * `routes`: [{ when: (system, user) => boolean, reply: (system, user) => object }], first match wins.
 */
export function useFakeLlm(routes) {
  const calls = [];
  setLlmClient({
    chat: {
      completions: {
        create: async ({ messages }) => {
          const system = messages.find((m) => m.role === "system")?.content || "";
          const user = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
          calls.push({ system, user });
          const route = routes.find((r) => r.when(system, user));
          if (!route) throw new Error(`Fake AI has no answer for: ${system.slice(0, 80)}`);
          return { choices: [{ message: { content: JSON.stringify(route.reply(system, user)) } }] };
        },
      },
    },
  });
  return calls;
}

export const resetLlm = () => setLlmClient(null);

/** Run agent ticks until it stops making progress (what the worker's follow-up ticks do). */
export async function tickUntilIdle(advance, runId, deps, max = 8) {
  let last = null;
  for (let i = 0; i < max; i++) {
    last = await advance(runId, deps);
    if (!last?.more || !last.progress) break;
  }
  return last;
}

/** A weekday "YYYY-MM-DD" at least `minDays` ahead (Karachi), for a time the client proposes. */
export function nextWeekday(minDays = 3) {
  const d = new Date(Date.now() + minDays * 24 * 3600 * 1000);
  while ([0, 6].includes(new Date(d.toLocaleString("en-US", { timeZone: "Asia/Karachi" })).getDay())) d.setDate(d.getDate() + 1);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(d);
}
