/**
 * Platform Factory
 *
 * Unified interface for per-platform operations used by the agent pipelines
 * and feature routes. Adapters wrap the existing platform-specific libs
 * (libs/linkedin-*.js, libs/rozee-*.js) so pipelines can iterate over
 * "enabled platforms" instead of branching on hard-coded ids.
 *
 * Adapter shape (all fields optional unless noted):
 *   id, label, accountsTable, comingSoon?
 *   getAccount(accountId)                           -> row | null
 *   testSession(account, keepOpen?)                 -> { isValid, reason, page?, context? }
 *   cleanupSession(context)                         -> void
 *   sendMessage(account, { leadUrl, message })      -> { success, ... }
 *   publishJob(account, job)                        -> { success, postUrl?, postContent?, ... }
 *   scrapeApplicants(account, job, opts)            -> { success, candidates[] }
 *   rateLimit: {
 *     checkMessages(accountId), incrementMessages(accountId, n?),
 *     checkInvites(accountId),  incrementInvites(accountId, n?),
 *   }
 */

import { linkedinAdapter } from "./linkedin";
import { rozeeAdapter } from "./rozee";
import { indeedAdapter } from "./indeed";

const ADAPTERS = {
  [linkedinAdapter.id]: linkedinAdapter,
  [rozeeAdapter.id]: rozeeAdapter,
  [indeedAdapter.id]: indeedAdapter,
};

export function getAdapter(platform) {
  const adapter = ADAPTERS[platform];
  if (!adapter) {
    throw new Error(
      `Unknown platform "${platform}". Supported: ${Object.keys(ADAPTERS).join(", ")}`
    );
  }
  return adapter;
}

export function listAdapters() {
  return Object.values(ADAPTERS);
}

export function listAvailableAdapters() {
  return Object.values(ADAPTERS).filter((a) => !a.comingSoon);
}

export function listAdapterIds() {
  return Object.keys(ADAPTERS);
}

export const PLATFORM_IDS = Object.freeze(Object.keys(ADAPTERS));


export { PLATFORM_META, PLATFORM_LIST, PLATFORM_ORDER, AVAILABLE_PLATFORMS, getPlatformMeta, isPlatformAvailable } from "./meta";
