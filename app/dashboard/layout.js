import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/libs/next-auth";
import config from "@/config";
import { SidebarProvider } from "@/components/layout/SidebarContext";
import { SIDEBAR_COOKIE } from "@/components/layout/sidebar-cookie";

export default async function LayoutPrivate({ children }) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect(config.auth.loginUrl);
  }

  const modes = Array.isArray(session.user?.modes) ? session.user.modes : [];
  const isAdmin = session.user?.role === "admin";

  // Admins can access everything regardless of modes.
  if (!isAdmin && modes.length === 0) {
    redirect("/onboarding");
  }

  const initialCollapsed = cookies().get(SIDEBAR_COOKIE)?.value !== "expanded";

  return <SidebarProvider initialCollapsed={initialCollapsed}>{children}</SidebarProvider>;
}
