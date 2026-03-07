/**
 * API functions for campaigns, leads, messages, and scraping
 * These functions will be used by React Query hooks
 */

// Campaign API functions
export const campaignApi = {
  // Fetch all campaigns
  fetchCampaigns: async () => {
    const response = await fetch("/api/campaigns");
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.message || "Failed to fetch campaigns");
    }
    
    return result.campaigns;
  },

  // Create a new campaign
  createCampaign: async (campaignData) => {
    const response = await fetch("/api/campaigns", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(campaignData),
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message || "Failed to create campaign");
    }

    return result.campaign;
  },

  // Update a campaign
  updateCampaign: async ({ campaignId, updateData }) => {
    const response = await fetch(`/api/campaigns/${campaignId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updateData),
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || "Failed to update campaign");
    }

    return result.campaign;
  },

  // Delete a campaign
  deleteCampaign: async (campaignId) => {
    const response = await fetch(`/api/campaigns/${campaignId}`, {
      method: "DELETE",
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || "Failed to delete campaign");
    }

    return result;
  },

  // Fetch leads for a campaign
  fetchCampaignLeads: async (campaignId) => {
    const response = await fetch(`/api/campaigns/${campaignId}/leads`);
    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message || "Failed to fetch leads");
    }

    return result.leads;
  },
};

// Lead API functions
export const leadApi = {
  // Add new leads to a campaign
  addLeads: async ({ campaignId, urls }) => {
    const response = await fetch(`/api/campaigns/${campaignId}/leads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ urls }),
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message || "Failed to add leads");
    }

    return result.leads;
  },

  // Update a lead
  updateLead: async ({ leadId, updateData }) => {
    const response = await fetch(`/api/leads/${leadId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updateData),
    });
    
    if (!response.ok) {
      throw new Error('Failed to update lead in database');
    }

    return response.json();
  },

  // Fetch posts for a lead
  fetchLeadPosts: async (leadId) => {
    const response = await fetch(`/api/leads/${leadId}/posts`);
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.message || "Failed to fetch posts");
    }

    return result.posts;
  },

  // Save posts to database
  savePosts: async ({ leadId, posts }) => {
    const response = await fetch(`/api/leads/${leadId}/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ posts }),
    });
    
    if (!response.ok) {
      throw new Error('Failed to save posts to database');
    }

    return response.json();
  },

  // Bulk update leads and posts (optimized)
  bulkUpdateLeads: async ({ leadsData }) => {
    const response = await fetch('/api/leads/bulk-update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ leadsData }),
    });
    
    if (!response.ok) {
      throw new Error('Failed to bulk update leads');
    }

    return response.json();
  },
};

// Message API functions
export const messageApi = {
  // Fetch message history for a lead
  fetchMessageHistory: async (leadId) => {
    const response = await fetch(`/api/messages/generate?leadId=${leadId}`);
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.message || "Failed to fetch message history");
    }

    return result.messages;
  },

  // Generate a new message
  generateMessage: async ({ leadId, model, customPrompt }) => {
    const response = await fetch("/api/messages/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        leadId,
        model: model || "llama-3.1-8b-instant",
        customPrompt: customPrompt || "",
      }),
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || "Failed to generate message");
    }

    return result.message;
  },

  // Delete a message
  deleteMessage: async (messageId) => {
    const response = await fetch(`/api/messages/${messageId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error("Failed to delete message");
    }

    return response.json();
  },
};

// Scraping API functions
export const scrapingApi = {
  // Check scraping status
  checkScrapingStatus: async (leadIds) => {
    const response = await fetch(`/api/scrape?leadIds=${leadIds}`);
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.message || "Failed to check scraping status");
    }
    
    return result.leads;
  },

  // Scrape profiles
  scrapeProfiles: async ({ urls, limitPerSource, deepScrape, rawData, streamProgress }) => {
    const response = await fetch("/api/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        urls,
        limitPerSource: limitPerSource ?? 10,
        deepScrape: deepScrape ?? true,
        rawData: rawData ?? false,
        streamProgress: streamProgress ?? false,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Failed to scrape profiles");
    }

    return result;
  },
};

// LinkedIn Connection Checking API functions
export const connectionCheckApi = {
  // Check for accepted connections (manual trigger)
  checkAcceptedConnections: async () => {
    const response = await fetch("/api/linkedin/connections/check-acceptance", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Failed to check connections");
    }

    return result;
  },
};
