import { redirect } from "next/navigation";

export default function HiringCandidatesRedirect({ params }) {
  redirect(`/dashboard/recruiter/jobs/${params.jobId}/candidates`);
}
