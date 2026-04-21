/**
 * Indeed Platform Adapter (Stub)
 *
 * Indeed integration is not yet implemented. This stub exists so the platform
 * factory can enumerate all three platforms, UI components can render a
 * consistent "Coming soon" state, and future work only needs to fill in the
 * method bodies below.
 */

const ID = "indeed";

function notSupported() {
  return {
    success: false,
    error: "Indeed integration is coming soon and not yet available.",
  };
}

export const indeedAdapter = {
  id: ID,
  label: "Indeed",
  comingSoon: true,
  accountsTable: null,

  async getAccount() {
    return null;
  },
  async testSession() {
    return { isValid: false, reason: "Indeed not yet supported" };
  },
  async cleanupSession() {
    /* noop */
  },
  async sendMessage() {
    return notSupported();
  },
  async publishJob() {
    return notSupported();
  },
  async scrapeApplicants() {
    return { success: false, error: notSupported().error, candidates: [] };
  },
  async search() {
    return { success: false, error: notSupported().error, results: [] };
  },

  rateLimit: {
    async checkMessages() {
      return { canSend: false, remaining: 0, limit: 0, resetsAt: new Date(), sent: 0 };
    },
    async incrementMessages() {
      /* noop */
    },
    async checkInvites() {
      return { canSend: false, remaining: 0, limit: 0, resetsAt: new Date(), sent: 0 };
    },
    async incrementInvites() {
      /* noop */
    },
  },
};
