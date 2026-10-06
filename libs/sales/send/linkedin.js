// LinkedIn actions for the sales agent, on top of the existing browser automation:
// connection invites, the acceptance check and a message to a connection. Each one respects the
// account's daily limits (libs/rate-limit-manager.js). Relative imports only (runs in the worker).
//
// Not yet tested end to end against a real account (see the sales agent notes).
import { linkedinAdapter } from "../../platforms/linkedin";
import { processInvitesDirectly } from "../../linkedin-invite-automation";
import { checkConnectionAcceptances } from "../../linkedin-connection-checker";
import {
  checkDailyConnectionCheckLimit, checkDailyLimit, checkDailyMessageLimit,
  incrementConnectionCheckCounter, incrementDailyCounter, incrementMessageCounter,
} from "../../rate-limit-manager";

export async function getLinkedInAccount(accountId) {
  return accountId ? linkedinAdapter.getAccount(accountId) : null;
}

/** How many invites and messages the account may still send today. */
export async function linkedInAllowance(accountId) {
  const [invites, messages] = await Promise.all([checkDailyLimit(accountId), checkDailyMessageLimit(accountId)]);
  return { invites: invites.canSend ? invites.remaining : 0, messages: messages.canSend ? messages.remaining : 0 };
}

/**
 * Send connection invites. `targets`: [{ id: leadId, url, name }] — for a company lead the url is the
 * decision-maker's profile. Lead invite fields are updated by the automation itself.
 * @returns {{ sent, alreadyConnected, alreadyPending, failed, errors }}
 */
export async function sendInvites(account, campaignId, targets) {
  const allowance = await checkDailyLimit(account.id);
  const batch = targets.slice(0, allowance.canSend ? allowance.remaining : 0);
  if (!batch.length) return { sent: 0, alreadyConnected: 0, alreadyPending: 0, failed: 0, errors: [], limited: true };

  const session = await linkedinAdapter.testSession(account, true);
  if (!session.isValid) throw new Error(`LinkedIn session invalid: ${session.reason}`);
  try {
    const results = await processInvitesDirectly(session.context, session.page, batch, "", campaignId);
    if (results.sent > 0) await incrementDailyCounter(account.id, results.sent);
    return { ...results, limited: batch.length < targets.length };
  } finally {
    await linkedinAdapter.cleanupSession(session.context);
  }
}

/**
 * Check which invites were accepted (updates the leads). Never sends messages: the agent sends
 * approved ones itself. Returns null when today's check allowance is used up.
 */
export async function checkAcceptances(account, userId) {
  const limit = await checkDailyConnectionCheckLimit(account.id);
  if (!limit.canCheck) return null;
  const result = await checkConnectionAcceptances(account, userId, { sendMessages: false });
  await incrementConnectionCheckCounter(account.id);
  return result;
}

/** Message one connection. Returns { success, error? }. */
export async function sendLinkedInMessage(account, { url, message, name }) {
  const limit = await checkDailyMessageLimit(account.id);
  if (!limit.canSend) return { success: false, error: "Daily LinkedIn message limit reached", limited: true };
  const result = await linkedinAdapter.sendMessage(account, { leadUrl: url, message, leadName: name || "there" });
  if (result?.success) await incrementMessageCounter(account.id);
  return result || { success: false, error: "No result from LinkedIn" };
}
