// Candidate pipeline stages, in pipeline order. Shared by API validation and the recruiter UI.
export const CANDIDATE_STAGES = [
  { value: "new", label: "New" },
  { value: "reviewed", label: "Reviewed" },
  { value: "shortlisted", label: "Shortlisted" },
  { value: "interview", label: "Interview" },
  { value: "offer", label: "Offer" },
  { value: "hired", label: "Hired" },
  { value: "rejected", label: "Rejected" },
];

export const CANDIDATE_STATUSES = CANDIDATE_STAGES.map((s) => s.value);

export function isValidCandidateStatus(status) {
  return CANDIDATE_STATUSES.includes(status);
}

export function stageLabel(status) {
  return CANDIDATE_STAGES.find((s) => s.value === status)?.label || status;
}
