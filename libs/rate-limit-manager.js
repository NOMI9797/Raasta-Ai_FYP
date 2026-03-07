/**
 * Rate Limit Manager
 * 
 * Manages daily invite limits for LinkedIn accounts to comply with platform restrictions.
 * Prevents account bans by enforcing configurable daily quotas.
 */

import { db } from './db';
import { linkedinAccounts } from './schema';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

/**
 * Check if account can send more invites today
 * Automatically resets counter if 24 hours have passed since last reset
 * 
 * @param {string} accountId - LinkedIn account ID
 * @returns {Promise<Object>} { canSend: boolean, remaining: number, limit: number, resetsAt: Date, sent: number }
 */
export async function checkDailyLimit(accountId) {
  const [account] = await db
    .select()
    .from(linkedinAccounts)
    .where(eq(linkedinAccounts.id, accountId))
    .limit(1);

  if (!account) {
    throw new Error(`Account ${accountId} not found`);
  }

  // Check if we need to reset (new day)
  const now = new Date();
  const lastReset = new Date(account.lastDailyReset);
  const hoursSinceReset = (now - lastReset) / (1000 * 60 * 60);

  if (hoursSinceReset >= 24) {
    // Reset counter for new day
    await db.update(linkedinAccounts)
      .set({
        dailyInvitesSent: 0,
        lastDailyReset: now
      })
      .where(eq(linkedinAccounts.id, accountId));

    console.log(`🔄 Daily counter reset for account ${accountId}`);

    return {
      canSend: true,
      remaining: account.dailyLimit,
      limit: account.dailyLimit,
      resetsAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      sent: 0
    };
  }

  const remaining = account.dailyLimit - account.dailyInvitesSent;
  const canSend = remaining > 0;

  return {
    canSend,
    remaining: Math.max(0, remaining),
    limit: account.dailyLimit,
    resetsAt: new Date(lastReset.getTime() + 24 * 60 * 60 * 1000),
    sent: account.dailyInvitesSent
  };
}

/**
 * Increment daily invite counter after successful invite
 * 
 * @param {string} accountId - LinkedIn account ID
 * @param {number} count - Number of invites to increment (default: 1)
 */
export async function incrementDailyCounter(accountId, count = 1) {
  await db.update(linkedinAccounts)
    .set({
      dailyInvitesSent: sql`${linkedinAccounts.dailyInvitesSent} + ${count}`,
      lastUsed: new Date()
    })
    .where(eq(linkedinAccounts.id, accountId));

  console.log(`📊 Daily counter incremented: +${count} for account ${accountId}`);
}

/**
 * Get account quotas (alias for checkDailyLimit for consistency)
 * 
 * @param {string} accountId - LinkedIn account ID
 * @returns {Promise<Object>} Quota information
 */
export async function getAccountQuotas(accountId) {
  return await checkDailyLimit(accountId);
}

/**
 * Manually reset daily counter (for admin/testing purposes)
 * 
 * @param {string} accountId - LinkedIn account ID
 */
export async function resetDailyCounter(accountId) {
  await db.update(linkedinAccounts)
    .set({
      dailyInvitesSent: 0,
      lastDailyReset: new Date()
    })
    .where(eq(linkedinAccounts.id, accountId));

  console.log(`🔄 Daily counter manually reset for account ${accountId}`);
}

/**
 * Check if account can perform connection check today (max 3 per day)
 * Automatically resets counter if 24 hours have passed since last reset
 * 
 * @param {string} accountId - LinkedIn account ID
 * @returns {Promise<Object>} { canCheck: boolean, remaining: number, limit: number, resetsAt: Date, checked: number }
 */
export async function checkDailyConnectionCheckLimit(accountId) {
  const [account] = await db
    .select()
    .from(linkedinAccounts)
    .where(eq(linkedinAccounts.id, accountId))
    .limit(1);

  if (!account) {
    throw new Error(`Account ${accountId} not found`);
  }

  const connectionCheckLimit = 3; // Max 3 connection checks per day

  // Check if we need to reset (new day)
  const now = new Date();
  const lastReset = new Date(account.lastConnectionCheckReset);
  const hoursSinceReset = (now - lastReset) / (1000 * 60 * 60);

  if (hoursSinceReset >= 24) {
    // Reset counter for new day
    await db.update(linkedinAccounts)
      .set({
        dailyConnectionChecks: 0,
        lastConnectionCheckReset: now
      })
      .where(eq(linkedinAccounts.id, accountId));

    console.log(`🔄 Connection check counter reset for account ${accountId}`);

    return {
      canCheck: true,
      remaining: connectionCheckLimit,
      limit: connectionCheckLimit,
      resetsAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      checked: 0
    };
  }

  const remaining = connectionCheckLimit - account.dailyConnectionChecks;
  const canCheck = remaining > 0;

  return {
    canCheck,
    remaining: Math.max(0, remaining),
    limit: connectionCheckLimit,
    resetsAt: new Date(lastReset.getTime() + 24 * 60 * 60 * 1000),
    checked: account.dailyConnectionChecks
  };
}

/**
 * Increment daily connection check counter after successful check
 * 
 * @param {string} accountId - LinkedIn account ID
 */
export async function incrementConnectionCheckCounter(accountId) {
  await db.update(linkedinAccounts)
    .set({
      dailyConnectionChecks: sql`${linkedinAccounts.dailyConnectionChecks} + 1`,
      lastUsed: new Date()
    })
    .where(eq(linkedinAccounts.id, accountId));

  console.log(`📊 Connection check counter incremented for account ${accountId}`);
}

/**
 * Manually reset connection check counter (for admin/testing purposes)
 * 
 * @param {string} accountId - LinkedIn account ID
 */
export async function resetConnectionCheckCounter(accountId) {
  await db.update(linkedinAccounts)
    .set({
      dailyConnectionChecks: 0,
      lastConnectionCheckReset: new Date()
    })
    .where(eq(linkedinAccounts.id, accountId));

  console.log(`🔄 Connection check counter manually reset for account ${accountId}`);
}

/**
 * Check if account can send messages today (max 10 per day)
 * Automatically resets counter if 24 hours have passed since last reset
 * 
 * @param {string} accountId - LinkedIn account ID
 * @returns {Promise<Object>} { canSend: boolean, remaining: number, limit: number, resetsAt: Date, sent: number }
 */
export async function checkDailyMessageLimit(accountId) {
  const [account] = await db
    .select()
    .from(linkedinAccounts)
    .where(eq(linkedinAccounts.id, accountId))
    .limit(1);

  if (!account) {
    throw new Error(`Account ${accountId} not found`);
  }

  const messageLimit = account.dailyMessageLimit || 10; // Default 10 messages per day

  // Check if we need to reset (new day)
  const now = new Date();
  const lastReset = new Date(account.lastMessageReset);
  const hoursSinceReset = (now - lastReset) / (1000 * 60 * 60);

  if (hoursSinceReset >= 24) {
    // Reset counter for new day
    await db.update(linkedinAccounts)
      .set({
        dailyMessagesSent: 0,
        lastMessageReset: now
      })
      .where(eq(linkedinAccounts.id, accountId));

    console.log(`🔄 Message counter reset for account ${accountId}`);

    return {
      canSend: true,
      remaining: messageLimit,
      limit: messageLimit,
      resetsAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      sent: 0
    };
  }

  const remaining = messageLimit - (account.dailyMessagesSent || 0);
  const canSend = remaining > 0;

  return {
    canSend,
    remaining: Math.max(0, remaining),
    limit: messageLimit,
    resetsAt: new Date(lastReset.getTime() + 24 * 60 * 60 * 1000),
    sent: account.dailyMessagesSent || 0
  };
}

/**
 * Increment daily message counter after successful message send
 * 
 * @param {string} accountId - LinkedIn account ID
 */
export async function incrementMessageCounter(accountId) {
  await db.update(linkedinAccounts)
    .set({
      dailyMessagesSent: sql`${linkedinAccounts.dailyMessagesSent} + 1`,
      lastUsed: new Date()
    })
    .where(eq(linkedinAccounts.id, accountId));

  console.log(`📊 Message counter incremented for account ${accountId}`);
}

/**
 * Manually reset message counter (for admin/testing purposes)
 * 
 * @param {string} accountId - LinkedIn account ID
 */
export async function resetMessageCounter(accountId) {
  await db.update(linkedinAccounts)
    .set({
      dailyMessagesSent: 0,
      lastMessageReset: new Date()
    })
    .where(eq(linkedinAccounts.id, accountId));

  console.log(`🔄 Message counter manually reset for account ${accountId}`);
}

