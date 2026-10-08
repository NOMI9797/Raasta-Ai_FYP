import { redirect } from "next/navigation";

// The Lead Scraper is now step 2 of the sales pipeline
export default function LeadScraperRedirect() {
  redirect("/dashboard/sales/find-leads");
}
