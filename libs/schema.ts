import { pgTable, text, timestamp, integer, boolean, json, uuid, varchar, index, uniqueIndex, vector } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Users table - for authentication and user isolation
// role: admin | sales_operator | recruiter — controls route access and workflows
export const users = pgTable('users', {
  id: text('id').primaryKey(), // Use text for OAuth IDs like Google
  email: text('email').notNull().unique(),
  name: text('name'),
  image: text('image'),
  password: text('password'), // For email/password authentication
  googleId: text('google_id').unique(),
  role: varchar('role', { length: 20 }).notNull().default('sales_operator'),
  modes: json('modes').default([]),
  stripeCustomerId: text('stripe_customer_id'),
  subscriptionStatus: varchar('subscription_status', { length: 20 }).default('free'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Campaigns table - with user isolation (Sales Operator module)
// icp_config: { targetRole, industry, serviceType } for AI message generation
export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  icpConfig: json('icp_config'),
  sources: json('sources').default(['linkedin']),
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
  source: varchar('source', { length: 20 }).notNull().default('linkedin'), // linkedin | rozee | indeed
  sourceData: json('source_data'), // Source-specific fields (e.g. Rozee skills, salary expectations)
  profilePicture: text('profile_picture'),
  posts: json('posts'), // Store scraped posts as JSON array
  inviteSent: boolean('invite_sent').default(false).notNull(),
  inviteStatus: varchar('invite_status', { length: 20 }).default('pending').notNull(), // pending, sent, accepted, rejected, failed
  inviteRetryCount: integer('invite_retry_count').default(0), // Track retry attempts
  inviteSentAt: timestamp('invite_sent_at'), // When invite was sent
  inviteAcceptedAt: timestamp('invite_accepted_at'), // When connection was accepted
  lastConnectionCheckAt: timestamp('last_connection_check_at'), // Last time we checked connections page
  messageSent: boolean('message_sent').default(false).notNull(),
  messageSentAt: timestamp('message_sent_at'),
  messageError: text('message_error'),
  // Conversation after the first message (libs/sales/conversation/status.js)
  conversationStatus: varchar('conversation_status', { length: 20 }),
  lastReplyAt: timestamp('last_reply_at'),
  followUpsSent: integer('follow_ups_sent').default(0).notNull(),
  nextFollowUpAt: timestamp('next_follow_up_at'),
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
  source: varchar('source', { length: 20 }).notNull().default('linkedin'), // platform the message was sent through
  status: varchar('status', { length: 20 }).notNull().default('draft'), // draft, approved, sent, scheduled
  channel: varchar('channel', { length: 20 }).notNull().default('linkedin'), // linkedin (invite + message) | email
  subject: text('subject'), // email subject line
  recipient: text('recipient'), // email address or LinkedIn profile URL the message goes to
  approvedAt: timestamp('approved_at'),
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

// Jobs table - Recruiter module (hiring workflow)
export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  linkedinAccountId: uuid('linkedin_account_id').references(() => linkedinAccounts.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  requiredSkills: json('required_skills'), // string[]
  experienceRange: varchar('experience_range', { length: 50 }),
  techStack: json('tech_stack'), // string[]
  salaryMin: integer('salary_min'),
  salaryMax: integer('salary_max'),
  salaryCurrency: varchar('salary_currency', { length: 10 }).default('USD'),
  location: text('location'),
  locationType: varchar('location_type', { length: 20 }), // remote | onsite | hybrid
  employmentType: varchar('employment_type', { length: 20 }), // full-time | part-time | contract
  linkedinPost: text('linkedin_post'),
  formalDescription: text('formal_description'),
  linkedinPostUrl: text('linkedin_post_url'),
  // Rozee.pk publishing
  rozeeAccountId: uuid('rozee_account_id'),
  rozeePost: text('rozee_post'),
  rozeePostUrl: text('rozee_post_url'),
  rozeePublishedAt: timestamp('rozee_published_at'),
  hiringConfig: json('hiring_config'), // see DEFAULT_HIRING_CONFIG in libs/hiring/config.js
  status: varchar('status', { length: 20 }).notNull().default('draft'), // draft | published | closed
  publishedAt: timestamp('published_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('jobs_user_created_idx').on(t.userId, t.createdAt),
]);

// Candidates table - Recruiter module (applicants per job)
export const candidates = pgTable('candidates', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'cascade' }).notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(), // recruiter who owns the job
  name: text('name').notNull(),
  email: text('email').notNull(),
  linkedinUrl: text('linkedin_url'),
  coverNote: text('cover_note'),
  resumeUrl: text('resume_url'),
  parsedData: json('parsed_data'), // { skills[], yearsExperience, education[], jobTitles[] }
  source: varchar('source', { length: 20 }).notNull().default('linkedin'), // linkedin | rozee | indeed | direct
  sourceData: json('source_data'), // Source-specific fields (Rozee profile URL, scraped extras)
  status: varchar('status', { length: 30 }).notNull().default('new'), // see libs/hiring/statuses.js
  // AI hiring pipeline (docs/ai-hiring/05-data-model.md §2)
  resumeKey: text('resume_key'),              // storage key of original file
  fitScore: integer('fit_score'),
  fitAnalysis: json('fit_analysis'),          // see 06-stage1-screening.md
  screenedAt: timestamp('screened_at'),
  finalScore: integer('final_score'),
  finalAnalysis: json('final_analysis'),      // see 11-stage2-evaluation.md
  finalDecidedAt: timestamp('final_decided_at'),
  decidedBy: text('decided_by'),              // 'system' | users.id
  appliedAt: timestamp('applied_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  // the pipeline, the job counts and the worker all read candidates by job and status; lists read them by owner
  index('candidates_job_status_idx').on(t.jobId, t.status),
  index('candidates_user_applied_idx').on(t.userId, t.appliedAt),
]);

// Interview Questions — AI hiring pipeline (docs/ai-hiring/05-data-model.md §3)
export const interviewQuestions = pgTable('interview_questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'cascade' }).notNull(),
  candidateId: uuid('candidate_id').references(() => candidates.id, { onDelete: 'cascade' }), // null = job-wide; set = personalised
  question: text('question').notNull(),
  category: varchar('category', { length: 20 }).notNull().default('technical'), // technical | role | behavioral
  difficulty: varchar('difficulty', { length: 10 }).notNull().default('medium'), // easy | medium | hard
  idealAnswer: text('ideal_answer').notNull(),
  expectedKeywords: json('expected_keywords').default([]),
  scoreWeight: integer('score_weight').default(1).notNull(), // 1-5
  orderIndex: integer('order_index').default(0).notNull(),
  source: varchar('source', { length: 10 }).notNull().default('ai'), // ai | manual
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('interview_questions_job_idx').on(t.jobId, t.isActive),
]);

// Interviews — one row per invite / AI interview (§4)
export const interviews = pgTable('interviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(), // job owner
  jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'cascade' }).notNull(),
  candidateId: uuid('candidate_id').references(() => candidates.id, { onDelete: 'cascade' }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('invited'),
  //  invited | opened | in_progress | completed | abandoned | expired | failed | cancelled
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  invitedAt: timestamp('invited_at').defaultNow().notNull(),
  reminderSentAt: timestamp('reminder_sent_at'),
  openedAt: timestamp('opened_at'),
  consentAt: timestamp('consent_at'),
  startedAt: timestamp('started_at'),
  endedAt: timestamp('ended_at'),
  lastActivityAt: timestamp('last_activity_at'),
  durationSec: integer('duration_sec'),
  questionSnapshot: json('question_snapshot'),   // questions frozen at start
  state: json('state'),                          // live session snapshot (resume)
  clientInfo: json('client_info'),               // UA, devices
  integrityEvents: json('integrity_events').default([]), // [{type:'tab_hidden', at}]
  recordingAudioKey: text('recording_audio_key'),
  recordingVideoKey: text('recording_video_key'),
  recordingStatus: varchar('recording_status', { length: 20 }).default('none'), // none|uploading|complete|failed
  totalQuestions: integer('total_questions'),
  totalAnswers: integer('total_answers'),
  followUpCount: integer('follow_up_count'),
  interviewScore: integer('interview_score'),
  communicationScore: integer('communication_score'),
  analysis: json('analysis'),                    // see 11-stage2-evaluation.md
  analysisStatus: varchar('analysis_status', { length: 20 }).default('pending'), // pending|processing|complete|failed|skipped
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('interviews_candidate_idx').on(t.candidateId),
  index('interviews_job_status_idx').on(t.jobId, t.status),
  index('interviews_user_status_idx').on(t.userId, t.status),
]);

// Interview Turns — full transcript (§5)
export const interviewTurns = pgTable('interview_turns', {
  id: uuid('id').primaryKey().defaultRandom(),
  interviewId: uuid('interview_id').references(() => interviews.id, { onDelete: 'cascade' }).notNull(),
  seq: integer('seq').notNull(),
  speaker: varchar('speaker', { length: 10 }).notNull(), // ai | candidate
  kind: varchar('kind', { length: 15 }).notNull(),       // greeting | question | follow_up | answer | closing | system
  questionId: text('question_id'),                       // base uuid or "fu-…"
  text: text('text').notNull(),
  startedAt: timestamp('started_at').notNull(),
  endedAt: timestamp('ended_at'),
  offsetMs: integer('offset_ms'),                        // ms since recording start (for video markers)
}, (t) => [
  uniqueIndex('interview_turns_seq_idx').on(t.interviewId, t.seq),
]);

// Interview Responses — scored Q&A (§6)
export const interviewResponses = pgTable('interview_responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  interviewId: uuid('interview_id').references(() => interviews.id, { onDelete: 'cascade' }).notNull(),
  questionId: uuid('question_id').references(() => interviewQuestions.id, { onDelete: 'set null' }), // base question
  questionText: text('question_text').notNull(),
  answer: text('answer').notNull(),
  isFollowUp: boolean('is_follow_up').default(false).notNull(),
  followUpDepth: integer('follow_up_depth').default(0).notNull(),
  followUpReason: varchar('follow_up_reason', { length: 30 }),
  score: integer('score'),
  scoreReasoning: text('score_reasoning'),
  keywordsCovered: json('keywords_covered').default([]),
  keywordsMissed: json('keywords_missed').default([]),
  scoredAt: timestamp('scored_at'),
  answeredAt: timestamp('answered_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('interview_responses_interview_idx').on(t.interviewId),
]);

// Rozee.pk Accounts table — mirror of linkedinAccounts for Rozee.pk session storage
export const rozeeAccounts = pgTable('rozee_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  sessionId: text('session_id').notNull().unique(),
  email: text('email').notNull(),
  userName: text('user_name'),
  profileImageUrl: text('profile_image_url'),
  cookies: json('cookies').notNull(),
  localStorage: json('local_storage'),
  sessionStorage: json('session_storage'),
  isActive: boolean('is_active').default(false).notNull(),
  tags: json('tags').default([]),
  dailyInvitesSent: integer('daily_invites_sent').default(0).notNull(),
  dailyLimit: integer('daily_limit').default(20).notNull(),
  lastDailyReset: timestamp('last_daily_reset').defaultNow().notNull(),
  dailyMessagesSent: integer('daily_messages_sent').default(0).notNull(),
  dailyMessageLimit: integer('daily_message_limit').default(15).notNull(),
  lastMessageReset: timestamp('last_message_reset').defaultNow().notNull(),
  lastUsed: timestamp('last_used').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Agent Configs — reusable agent configurations per user
export const agentConfigs = pgTable('agent_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  pipelineType: varchar('pipeline_type', { length: 30 }).notNull(),
  name: text('name').notNull(),
  mode: varchar('mode', { length: 20 }).notNull().default('semi_auto'),
  config: json('config').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Agent Runs — tracks each execution of an agent pipeline
export const agentRuns = pgTable('agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentConfigId: uuid('agent_config_id').references(() => agentConfigs.id, { onDelete: 'set null' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  pipelineType: varchar('pipeline_type', { length: 30 }).notNull(),
  jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }), // recruiter runs: the job the agent manages
  campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }), // sales runs: the campaign the agent works
  mode: varchar('mode', { length: 20 }).notNull(),
  status: varchar('status', { length: 30 }).notNull().default('queued'),
  currentStep: varchar('current_step', { length: 50 }),
  totalSteps: integer('total_steps'),
  config: json('config'),   // config snapshot at launch
  results: json('results'),
  errorMessage: text('error_message'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('agent_runs_job_status_idx').on(t.jobId, t.status),
  index('agent_runs_user_created_idx').on(t.userId, t.createdAt),
]);

// Agent Steps — logs each step of a run
export const agentSteps = pgTable('agent_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentRunId: uuid('agent_run_id').references(() => agentRuns.id, { onDelete: 'cascade' }).notNull(),
  stepKey: varchar('step_key', { length: 50 }).notNull(),
  stepIndex: integer('step_index').notNull(),
  status: varchar('status', { length: 30 }).notNull().default('pending'),
  input: json('input'),
  output: json('output'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
}, (t) => [
  index('agent_steps_run_idx').on(t.agentRunId, t.stepIndex),
]);

// Agent Actions — every action the supervised recruiter agent takes or proposes.
// Doubles as the approval inbox (status pending) and the audit trail.
export const agentActions = pgTable('agent_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentRunId: uuid('agent_run_id').references(() => agentRuns.id, { onDelete: 'cascade' }).notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
  candidateId: uuid('candidate_id').references(() => candidates.id, { onDelete: 'cascade' }),
  campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }), // sales actions
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
  action: varchar('action', { length: 40 }).notNull(),   // libs/agent/policy.js AGENT_ACTION
  route: varchar('route', { length: 10 }).notNull(),     // auto | ask | human
  status: varchar('status', { length: 20 }).notNull().default('pending'), // pending | approved | rejected | executed | failed | superseded
  blocking: boolean('blocking').notNull().default(false), // the run waits for it
  summary: text('summary').notNull(),
  payload: json('payload'),           // what will be done
  evidence: json('evidence'),         // why (scores, skills, flags)
  escalations: json('escalations').default([]),
  result: json('result'),
  dedupeKey: text('dedupe_key'),      // one action per subject, e.g. shortlist:<candidateId>
  decidedBy: text('decided_by'),      // user id, or "agent" for automatic actions
  decidedAt: timestamp('decided_at'),
  decisionNote: text('decision_note'),
  executedAt: timestamp('executed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('agent_actions_run_idx').on(t.agentRunId, t.createdAt),
  index('agent_actions_user_status_idx').on(t.userId, t.status),
  index('agent_actions_dedupe_idx').on(t.dedupeKey),
]);

// Job Publications — where each job post went, per platform. One row per attempt (automatic or hand-off).
// Also the guard for posting limits and for never posting the same job twice at once.
export const jobPublications = pgTable('job_publications', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'cascade' }).notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  platform: varchar('platform', { length: 20 }).notNull(),        // linkedin | rozee
  accountId: uuid('account_id'),                                  // linkedin_accounts / rozee_accounts id (automatic posts)
  mode: varchar('mode', { length: 10 }).notNull(),                // auto | handoff
  status: varchar('status', { length: 20 }).notNull(),            // publishing | published | failed | needs_login | handed_off
  initiatedBy: varchar('initiated_by', { length: 10 }).notNull().default('user'), // user | agent
  content: text('content'),                                       // the text that was posted
  postUrl: text('post_url'),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
}, (t) => [
  index('job_publications_job_idx').on(t.jobId, t.platform, t.createdAt),
  index('job_publications_account_idx').on(t.accountId, t.createdAt),
  uniqueIndex('job_publications_one_inflight').on(t.jobId, t.platform).where(sql`${t.status} = 'publishing'`),
]);

// Notifications — in-app alerts shown in the top bar bell
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  type: varchar('type', { length: 40 }).notNull(), // see libs/notifications.js NOTIFICATION_TYPES
  title: text('title').notNull(),
  body: text('body'),
  link: text('link'),                               // in-app path to open, e.g. /dashboard/recruiter/jobs/<id>/candidates
  readAt: timestamp('read_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('notifications_user_created_idx').on(t.userId, t.createdAt),
]);

// Sales knowledge base (RAG) — what the sales agent may tell clients. See libs/sales/knowledge/
export const kbDocuments = pgTable('kb_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  title: text('title').notNull(),
  category: varchar('category', { length: 30 }).notNull().default('other'), // services | pricing | process | faq | case_study | about | other
  kind: varchar('kind', { length: 10 }).notNull().default('note'),          // note | file | web
  source: text('source'),                                                   // file name or page URL
  content: text('content').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('ready'),     // ready | failed
  error: text('error'),
  chunkCount: integer('chunk_count').notNull().default(0),
  isSample: boolean('is_sample').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('kb_documents_user_idx').on(t.userId, t.updatedAt),
]);

// One searchable passage of a document. The table also has a generated `tsv` column for keyword search.
export const kbChunks = pgTable('kb_chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').references(() => kbDocuments.id, { onDelete: 'cascade' }).notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 384 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('kb_chunks_user_idx').on(t.userId),
  index('kb_chunks_document_idx').on(t.documentId, t.chunkIndex),
]);

// Sales conversations — every email in a lead's thread. See libs/sales/inbox/ and libs/sales/conversation/
export const conversationMessages = pgTable('conversation_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }).notNull(),
  campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }).notNull(),
  direction: varchar('direction', { length: 3 }).notNull(),          // out | in
  channel: varchar('channel', { length: 20 }).notNull().default('email'), // email | linkedin
  kind: varchar('kind', { length: 20 }).notNull(),                   // outreach | reply | follow_up | inbound
  status: varchar('status', { length: 20 }).notNull(),               // draft | approved | sent | discarded | received
  fromAddress: text('from_address'),
  toAddress: text('to_address'),
  subject: text('subject'),
  body: text('body').notNull(),
  emailMessageId: text('email_message_id'),                          // RFC 5322 Message-ID, for threading
  inReplyTo: text('in_reply_to'),
  references: text('references'),
  intent: varchar('intent', { length: 30 }),                         // inbound: what the client wants (libs/sales/conversation/intents.js)
  meta: json('meta'),                                                // knowledge passages used, offered slots, …
  handledAt: timestamp('handled_at'),                                // inbound: when the agent dealt with it
  sentAt: timestamp('sent_at'),
  receivedAt: timestamp('received_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('conversation_messages_lead_idx').on(t.leadId, t.createdAt),
  index('conversation_messages_user_idx').on(t.userId, t.createdAt),
  uniqueIndex('conversation_messages_email_id_unique').on(t.emailMessageId).where(sql`${t.emailMessageId} IS NOT NULL`),
]);

// Per-user sales settings: meeting hours, link and length, follow-up timing. See libs/sales/meetings/settings.js
export const salesSettings = pgTable('sales_settings', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  companyName: text('company_name'),
  timezone: varchar('timezone', { length: 60 }).notNull().default('Asia/Karachi'),
  availability: json('availability'),   // { mon: [{ start: "10:00", end: "17:00" }], … }
  meetingMinutes: integer('meeting_minutes').notNull().default(30),
  bufferMinutes: integer('buffer_minutes').notNull().default(15),
  minNoticeHours: integer('min_notice_hours').notNull().default(24),
  meetingTitle: text('meeting_title'),
  meetingLink: text('meeting_link'),    // Google Meet / Zoom / Teams link sent with confirmations
  followUpDays: json('follow_up_days'), // e.g. [3, 7]
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Meetings leads agreed to (or times we offered). See libs/sales/meetings/
export const meetings = pgTable('meetings', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }).notNull(),
  campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }).notNull(),
  status: varchar('status', { length: 20 }).notNull(), // proposed | confirmed | completed | cancelled | no_show
  title: text('title').notNull(),
  startAt: timestamp('start_at'),
  endAt: timestamp('end_at'),
  timezone: varchar('timezone', { length: 60 }).notNull(),
  proposedSlots: json('proposed_slots'), // [{ start, end }] offered while status is proposed
  attendeeName: text('attendee_name'),
  attendeeEmail: text('attendee_email'),
  location: text('location'),
  notes: text('notes'),
  outcome: text('outcome'),
  bookedBy: varchar('booked_by', { length: 10 }).notNull().default('agent'), // agent | user
  conversationMessageId: uuid('conversation_message_id').references(() => conversationMessages.id, { onDelete: 'set null' }),
  icsUid: text('ics_uid'),
  icsSequence: integer('ics_sequence').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('meetings_user_start_idx').on(t.userId, t.startAt),
  index('meetings_lead_idx').on(t.leadId, t.createdAt),
]);

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