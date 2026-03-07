"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState(null);
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/");
      return;
    }
    if (session.user?.role !== "admin") {
      router.replace("/dashboard");
    }
  }, [session, status, router]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center">
        <div className="loading loading-spinner loading-lg text-primary"></div>
      </div>
    );
  }

  if (!session || session.user?.role !== "admin") return null;

  useEffect(() => {
    if (!session || session.user?.role !== "admin") return;

    const fetchUsers = async () => {
      try {
        setLoadingUsers(true);
        setError("");
        const res = await fetch("/api/admin/users");
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to load users");
        }
        setUsers(data.users || []);
      } catch (err) {
        setError(err.message || "Failed to load users");
      } finally {
        setLoadingUsers(false);
      }
    };

    fetchUsers();
  }, [session]);

  const roleCounts = useMemo(() => {
    const counts = { admin: 0, sales_operator: 0, recruiter: 0 };
    for (const user of users) {
      if (user.role && counts[user.role] !== undefined) {
        counts[user.role] += 1;
      }
    }
    return counts;
  }, [users]);

  const handleRoleChange = async (userId, newRole) => {
    if (!newRole) return;
    setSuccessMessage("");
    setError("");

    try {
      setUpdatingId(userId);
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId, role: newRole }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update role");
      }

      setUsers((prev) =>
        prev.map((u) => (u.id === data.user.id ? { ...u, role: data.user.role } : u))
      );

      const isSelf = session?.user?.id === data.user.id;
      setSuccessMessage(
        `${data.user.email} is now ${data.user.role}${
          isSelf ? " (this will apply to your next requests automatically)" : ""
        }`
      );
      setTimeout(() => setSuccessMessage(""), 4000);
    } catch (err) {
      setError(err.message || "Failed to update role");
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="h-screen bg-base-100 flex overflow-hidden">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} activeSection="admin" />
      <div className={`flex-1 transition-all duration-300 ${sidebarCollapsed ? "ml-16" : "ml-64"} flex flex-col h-full overflow-hidden`}>
        <TopBar />
        <main className="flex-1 p-6 overflow-auto space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-base-content">Admin panel</h1>
              <p className="mt-1 text-base-content/70 text-sm">
                Manage users and assign roles. Change your own role here when you want to test other experiences.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="stat bg-base-200 rounded-xl shadow-sm border border-base-300">
              <div className="stat-title text-xs uppercase tracking-wide text-base-content/60">
                Admins
              </div>
              <div className="stat-value text-2xl">{roleCounts.admin}</div>
              <div className="stat-desc text-xs text-base-content/60">
                Full system access
              </div>
            </div>
            <div className="stat bg-base-200 rounded-xl shadow-sm border border-base-300">
              <div className="stat-title text-xs uppercase tracking-wide text-base-content/60">
                Sales operators
              </div>
              <div className="stat-value text-2xl">{roleCounts.sales_operator}</div>
              <div className="stat-desc text-xs text-base-content/60">
                Campaigns & workflows
              </div>
            </div>
            <div className="stat bg-base-200 rounded-xl shadow-sm border border-base-300">
              <div className="stat-title text-xs uppercase tracking-wide text-base-content/60">
                Recruiters
              </div>
              <div className="stat-value text-2xl">{roleCounts.recruiter}</div>
              <div className="stat-desc text-xs text-base-content/60">
                Hiring pipelines
              </div>
            </div>
          </div>

          {(error || successMessage) && (
            <div className="space-y-2">
              {error && (
                <div className="alert alert-error shadow-sm">
                  <span>{error}</span>
                </div>
              )}
              {successMessage && (
                <div className="alert alert-success shadow-sm">
                  <span>{successMessage}</span>
                </div>
              )}
            </div>
          )}

          <section className="bg-base-200 rounded-xl shadow-sm border border-base-300">
            <div className="px-4 py-3 border-b border-base-300 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-base-content">Users & roles</h2>
                <p className="text-xs text-base-content/60">
                  Update a user&apos;s role. Changes apply immediately to new requests.
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              {loadingUsers ? (
                <div className="p-6 flex items-center justify-center">
                  <span className="loading loading-spinner loading-md text-primary" />
                </div>
              ) : users.length === 0 ? (
                <div className="p-6 text-sm text-base-content/60 text-center">
                  No users found yet.
                </div>
              ) : (
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th className="w-[40%]">User</th>
                      <th>Role</th>
                      <th>Subscription</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => {
                      const isSelf = session?.user?.id === u.id;
                      return (
                        <tr key={u.id} className={isSelf ? "bg-base-100" : ""}>
                          <td>
                            <div className="flex flex-col">
                              <span className="font-medium text-sm">
                                {u.name || "—"}
                                {isSelf && (
                                  <span className="ml-2 badge badge-xs badge-outline">
                                    You
                                  </span>
                                )}
                              </span>
                              <span className="text-xs text-base-content/60">
                                {u.email}
                              </span>
                            </div>
                          </td>
                          <td>
                            <select
                              className="select select-bordered select-xs"
                              value={u.role || "sales_operator"}
                              disabled={updatingId === u.id}
                              onChange={(e) =>
                                handleRoleChange(u.id, e.target.value)
                              }
                            >
                              <option value="admin">Admin</option>
                              <option value="sales_operator">Sales operator</option>
                              <option value="recruiter">Recruiter</option>
                            </select>
                          </td>
                          <td className="text-xs text-base-content/60">
                            {u.subscriptionStatus || "free"}
                          </td>
                          <td className="text-xs text-base-content/60">
                            {u.createdAt
                              ? new Date(u.createdAt).toLocaleDateString()
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
