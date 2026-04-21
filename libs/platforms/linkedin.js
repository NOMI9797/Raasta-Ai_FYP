/**
 * LinkedIn Platform Adapter
 *
 * Wraps the existing libs/linkedin-* modules behind the shared platform
 * adapter contract (see libs/platforms/index.js). Keeps behaviour identical
 * — adapters do not change business logic; they just unify the surface.
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import { linkedinAccounts } from "../schema";
import {
  testLinkedInSession,
  cleanupBrowserSession,
} from "../linkedin-session-validator";
import { sendMessageToLead } from "../linkedin-message-sender";
import { publishLinkedInPost } from "../linkedin-post-publisher";
import {
  checkDailyMessageLimitForPlatform,
  incrementMessageCounterForPlatform,
  checkDailyLimitForPlatform,
  incrementDailyCounterForPlatform,
} from "../rate-limit-manager";

const ID = "linkedin";

async function getAccount(accountId) {
  const [account] = await db
    .select()
    .from(linkedinAccounts)
    .where(eq(linkedinAccounts.id, accountId))
    .limit(1);
  return account || null;
}

async function testSession(account, keepOpen = false) {
  return testLinkedInSession(account, keepOpen);
}

async function cleanupSession(context) {
  return cleanupBrowserSession(context);
}

async function sendMessageWithPage(page, { leadUrl, message, leadName }) {
  return sendMessageToLead(page, leadUrl, message, leadName);
}

async function sendMessage(account, { leadUrl, message, leadName }) {
  const sessionCheck = await testSession(account, true);
  if (!sessionCheck.isValid) {
    return { success: false, error: `Session invalid: ${sessionCheck.reason}` };
  }
  try {
    return await sendMessageWithPage(sessionCheck.page, { leadUrl, message, leadName });
  } finally {
    await cleanupSession(sessionCheck.context);
  }
}

async function publishJobWithPage(page, job) {
  if (!job?.linkedinPost) {
    return { success: false, error: "No LinkedIn post content for this job" };
  }
  return publishLinkedInPost(page, job.linkedinPost);
}

async function publishJob(account, job) {
  const sessionCheck = await testSession(account, true);
  if (!sessionCheck.isValid) {
    return { success: false, error: `Session invalid: ${sessionCheck.reason}` };
  }
  try {
    return await publishJobWithPage(sessionCheck.page, job);
  } finally {
    await cleanupSession(sessionCheck.context);
  }
}

// LinkedIn job applicant scraping is handled by LinkedIn Easy-Apply flows
// elsewhere and is not part of this adapter yet. Returning null signals
// "not supported" so the pipeline can skip this step for LinkedIn.
async function scrapeApplicants() {
  return null;
}

// LinkedIn profile search (Sales Navigator) is not wired up yet. The Lead
// Scraper module calls this for every registered adapter; for LinkedIn we
// just return an empty "not supported" payload so the UI can render a
// friendly "Coming soon" state instead of throwing.
async function search() {
  return {
    success: false,
    error: "LinkedIn profile search isn't wired up yet. Add URLs manually for now.",
    results: [],
  };
}

export const linkedinAdapter = {
  id: ID,
  label: "LinkedIn",
  accountsTable: linkedinAccounts,

  getAccount,
  testSession,
  cleanupSession,
  sendMessage,
  sendMessageWithPage,
  publishJob,
  publishJobWithPage,
  scrapeApplicants,
  search,

  rateLimit: {
    checkMessages: (accountId) => checkDailyMessageLimitForPlatform(accountId, ID),
    incrementMessages: (accountId) => incrementMessageCounterForPlatform(accountId, ID),
    checkInvites: (accountId) => checkDailyLimitForPlatform(accountId, ID),
    incrementInvites: (accountId, n = 1) =>
      incrementDailyCounterForPlatform(accountId, ID, n),
  },
};
