import { pgTable, text, timestamp, integer, boolean, json, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Users table - for authentication and user isolation
export const users = pgTable('users', {
  id: text('id').primaryKey(), // Use text for OAuth IDs like Google
  email: text('email').notNull().unique(),
  name: text('name'),
  image: text('image'),
  password: text('password'), // For email/password authentication
  googleId: text('google_id').unique(),
  stripeCustomerId: text('stripe_customer_id'),
  subscriptionStatus: varchar('subscription_status', { length: 20 }).default('free'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Campaigns table - with user isolation
export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  status: varchar('status', { length: 20 }).notNull().default('draft'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Leads table - with user isolation
export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }).notNull(),
  url: text('url').notNull(),
  name: text('name'),
  title: text('title'),
  company: text('company'),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  profilePicture: text('profile_picture'),
  posts: json('posts'), // Store scraped posts as JSON array
  inviteSent: boolean('invite_sent').default(false).notNull(),
  inviteStatus: varchar('invite_status', { length: 20 }).default('pending').notNull(), // pending, sent, accepted, rejected, failed
  inviteRetryCount: integer('invite_retry_count').default(0), // Track retry attempts
  inviteSentAt: timestamp('invite_sent_at'), // When invite was sent
  inviteAcceptedAt: timestamp('invite_accepted_at'), // When connection was accepted
  lastConnectionCheckAt: timestamp('last_connection_check_at'), // Last time we checked connections page
  // Message tracking
  messageSent: boolean('message_sent').default(false).notNull(),
  messageSentAt: timestamp('message_sent_at'), // When message was sent on LinkedIn
  messageError: text('message_error'), // Error message if sending failed
  addedAt: timestamp('added_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Posts table - with user isolation
export const posts = pgTable('posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }).notNull(),
  content: text('content').notNull(),
  timestamp: timestamp('timestamp').notNull(),
  likes: integer('likes').default(0),
  comments: integer('comments').default(0),
  shares: integer('shares').default(0),
  engagement: integer('engagement').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Messages table - with user isolation
export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }).notNull(),
  campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }).notNull(),
  content: text('content').notNull(),
  model: varchar('model', { length: 50 }).notNull().default('llama-3.1-8b-instant'),
  customPrompt: text('custom_prompt'),
  postsAnalyzed: integer('posts_analyzed').default(3),
  status: varchar('status', { length: 20 }).notNull().default('draft'), // draft, sent, scheduled
  sentAt: timestamp('sent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// LinkedIn Accounts table - with user isolation
export const linkedinAccounts = pgTable('linkedin_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  sessionId: text('session_id').notNull().unique(),
  email: text('email').notNull(),
  userName: text('user_name'),
  profileImageUrl: text('profile_image_url'),
  cookies: json('cookies').notNull(), // Store LinkedIn cookies as JSON
  localStorage: json('local_storage'), // Store localStorage data as JSON
  sessionStorage: json('session_storage'), // Store sessionStorage data as JSON
  isActive: boolean('is_active').default(false).notNull(),
  connectionInvites: integer('connection_invites').default(0),
  followUpMessages: integer('follow_up_messages').default(0),
  tags: json('tags').default([]), // Store tags as JSON array
  salesNavActive: boolean('sales_nav_active').default(true),
  // Daily rate limiting
  dailyInvitesSent: integer('daily_invites_sent').default(0).notNull(),
  dailyLimit: integer('daily_limit').default(30).notNull(),
  lastDailyReset: timestamp('last_daily_reset').defaultNow().notNull(),
  // Connection check rate limiting
  dailyConnectionChecks: integer('daily_connection_checks').default(0).notNull(),
  lastConnectionCheckReset: timestamp('last_connection_check_reset').defaultNow().notNull(),
  // Message sending rate limiting
  dailyMessagesSent: integer('daily_messages_sent').default(0).notNull(),
  dailyMessageLimit: integer('daily_message_limit').default(10).notNull(),
  lastMessageReset: timestamp('last_message_reset').defaultNow().notNull(),
  lastUsed: timestamp('last_used').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Workflow Jobs table - for background processing
export const workflowJobs = pgTable('workflow_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }).notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  accountId: uuid('account_id').references(() => linkedinAccounts.id, { onDelete: 'cascade' }).notNull(),
  status: varchar('status', { length: 20 }).default('queued').notNull(), // queued, processing, paused, cancelled, completed, failed, timeout
  progress: integer('progress').default(0), // 0-100
  totalLeads: integer('total_leads'),
  processedLeads: integer('processed_leads').default(0),
  results: json('results'), // Store final results as JSON
  errorMessage: text('error_message'),
  customMessage: text('custom_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  pausedAt: timestamp('paused_at'), // When job was paused
  resumedAt: timestamp('resumed_at'), // When job was last resumed
  pauseCount: integer('pause_count').default(0), // Number of times paused
});

// Database initialization function
export async function initializeDatabase() {
  const { migrate } = await import('drizzle-orm/postgres-js/migrator');
  const { db } = await import('./db');
  
  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
}