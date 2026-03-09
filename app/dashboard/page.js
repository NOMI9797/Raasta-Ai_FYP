import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/libs/next-auth";
import config from "@/config";

export const dynamic = "force-dynamic";

// Role-based default landing: admin → admin, recruiter → hiring, sales_operator → campaigns
export default async function Dashboard() {
  const session = await getServerSession(authOptions);
  if (!session) redirect(config.auth.loginUrl);

  const role = session.user?.role ?? "sales_operator";
  if (role === "admin") redirect("/dashboard/admin");
  if (role === "recruiter") redirect("/dashboard/recruiter");
  redirect("/dashboard/campaigns");
}
