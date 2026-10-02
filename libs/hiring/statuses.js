// Candidate status machine for the AI hiring pipeline (docs/ai-hiring/05-data-model.md §8).
// Routes and UI must use these constants instead of hard-coded status strings.
export const CANDIDATE_STATUS = {
  NEW: 'new', SCREENED: 'screened', REVIEWED: 'reviewed',
  SHORTLISTED: 'shortlisted', NOT_SHORTLISTED: 'not_shortlisted',
  INTERVIEW_INVITED: 'interview_invited', INTERVIEW_EXPIRED: 'interview_expired',
  INTERVIEW_IN_PROGRESS: 'interview_in_progress', INTERVIEW_COMPLETED: 'interview_completed',
  FINAL_SHORTLISTED: 'final_shortlisted', FINAL_REJECTED: 'final_rejected',
  HIRED: 'hired', REJECTED: 'rejected',
};
export const STATUS_META = {
  new:                   { label: 'New',                 badge: 'badge-ghost',     stage: 'applied' },
  screened:              { label: 'Screened',            badge: 'badge-info',      stage: 'applied' },
  reviewed:              { label: 'Reviewed',            badge: 'badge-info',      stage: 'applied' },
  shortlisted:           { label: 'Shortlisted',         badge: 'badge-primary',   stage: 'shortlisted' },
  not_shortlisted:       { label: 'Not shortlisted',     badge: 'badge-neutral',   stage: 'closed' },
  interview_invited:     { label: 'Interview invited',   badge: 'badge-secondary', stage: 'interview' },
  interview_expired:     { label: 'Invite expired',      badge: 'badge-warning',   stage: 'interview' },
  interview_in_progress: { label: 'Interviewing',        badge: 'badge-accent',    stage: 'interview' },
  interview_completed:   { label: 'Interviewed',         badge: 'badge-accent',    stage: 'evaluation' },
  final_shortlisted:     { label: 'Final shortlist',     badge: 'badge-success',   stage: 'decision' },
  final_rejected:        { label: 'Not selected',        badge: 'badge-error',     stage: 'decision' },
  hired:                 { label: 'Hired',               badge: 'badge-success',   stage: 'decision' },
  rejected:              { label: 'Rejected',            badge: 'badge-error',     stage: 'closed' },
};
export const KANBAN_STAGES = [
  { value: 'applied', label: 'Applied' }, { value: 'shortlisted', label: 'Shortlisted' },
  { value: 'interview', label: 'Interview' }, { value: 'evaluation', label: 'Evaluation' },
  { value: 'decision', label: 'Decision' }, { value: 'closed', label: 'Closed' },
];
export const MANUAL_TRANSITIONS = {
  new: ['shortlisted', 'not_shortlisted', 'rejected'],
  screened: ['shortlisted', 'not_shortlisted', 'rejected'],
  reviewed: ['shortlisted', 'not_shortlisted', 'rejected'],
  not_shortlisted: ['shortlisted', 'rejected'],
  shortlisted: ['not_shortlisted', 'rejected'],
  interview_invited: ['rejected'],
  interview_expired: ['rejected'],               // re-invite via API, not PATCH
  interview_in_progress: [],
  interview_completed: ['final_shortlisted', 'final_rejected', 'rejected'],
  final_shortlisted: ['hired', 'final_rejected', 'rejected'],
  final_rejected: ['final_shortlisted', 'rejected'],
  hired: [], rejected: ['shortlisted'],
};
export const ALL_STATUSES = Object.keys(STATUS_META);
export function canTransition(from, to) { return (MANUAL_TRANSITIONS[from] || []).includes(to); }
