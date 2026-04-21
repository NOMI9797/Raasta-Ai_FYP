import { redirect } from "next/navigation";

export default function StatisticsRedirect() {
  redirect("/dashboard/analytics");
}
