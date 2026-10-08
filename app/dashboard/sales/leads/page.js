import { redirect } from "next/navigation";

// Leads are now worked on step by step: they are added in Find leads and studied in Research
export default function SalesLeadsRedirect() {
  redirect("/dashboard/sales/research");
}
