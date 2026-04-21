import { redirect } from "next/navigation";

export default function RecruiterIndexRedirect() {
  redirect("/dashboard/recruiter/jobs");
}
