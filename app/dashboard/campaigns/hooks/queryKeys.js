/**
 * Query keys for React Query caching
 * Organized in a hierarchical structure for better cache invalidation
 */

export const campaignKeys = {
  // Base key for all campaign-related queries
  all: ['campaigns'] ,
  // List of campaigns
  lists: () => [...campaignKeys.all, 'list'],
  // Individual campaign
  detail: (id) => [...campaignKeys.all, 'detail', id],
  // Campaign leads
  leads: (id) => [...campaignKeys.all, id, 'leads'],
};

export const leadKeys = {
  // Base key for all lead-related queries
  all: ['leads'],
  // List of leads
  lists: () => [...leadKeys.all, 'list'],
  // Individual lead
  detail: (id) => [...leadKeys.all, 'detail', id],
  // Lead posts
  posts: (id) => [...leadKeys.all, id, 'posts'],
};

export const messageKeys = {
  // Base key for all message-related queries
  all: ['messages'],
  // Messages for a specific lead
  forLead: (leadId) => [...messageKeys.all, 'lead', leadId],
  // Individual message
  detail: (id) => [...messageKeys.all, 'detail', id],
};

export const scrapingKeys = {
  // Base key for all scraping-related queries
  all: ['scraping'],
  // Scraping status for specific leads
  status: (leadIds) => [...scrapingKeys.all, 'status', leadIds],
};

export const statsKeys = {
  // Base key for all statistics-related queries
  all: ['stats'],
  // Global statistics across all campaigns
  global: () => [...statsKeys.all, 'global'],
  // Statistics for a specific campaign
  campaign: (id) => [...statsKeys.all, 'campaign', id],
};
