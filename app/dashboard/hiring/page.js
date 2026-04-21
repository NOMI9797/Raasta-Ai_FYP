import { redirect } from "next/navigation";

export default function HiringRedirect() {
  redirect("/dashboard/recruiter/jobs");
}
