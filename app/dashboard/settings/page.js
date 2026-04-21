"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Settings as SettingsIcon, User, Shield, Plug } from "lucide-react";
import Link from "next/link";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";

const MODES = [
  { id: "recruiter", label: "Recruiter" },
  { id: "sales", label: "Sales" },
];

export default function SettingsPage() {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [modes, setModes] = useState([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/");
      return;
    }
    const current = Array.isArray(session.user?.modes) ? session.user.modes : [];
    setModes(current);
  }, [session, status, router]);

  const toggleMode = (id) => {
    setModes((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
  };

  const save = async () => {
    if (saving) return;
    if (modes.length === 0) {
      setMessage("Select at least one mode.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/user/modes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modes }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Failed");
      await update();
      setMessage("Saved.");
    } catch (e) {
      setMessage(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center">
        <div className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }
  if (!session) return null;

  const isAdmin = session.user?.role === "admin";

  return (
    <div className="min-h-screen bg-base-100 flex">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        activeSection="settings"
      />
      <div className={`flex-1 transition-all duration-300 ${sidebarCollapsed ? "ml-16" : "ml-64"} flex flex-col`}>
        <TopBar title="Settings" />
        <main className="flex-1 p-6 space-y-6 max-w-3xl">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <SettingsIcon className="h-6 w-6" /> Settings
            </h1>
            <p className="text-sm text-base-content/70 mt-1">
              Manage your profile, modes and connected platforms.
            </p>
          </div>

          <section className="card bg-base-100 border border-base-300">
            <div className="card-body">
              <h2 className="card-title text-base flex items-center gap-2">
                <User className="h-4 w-4" /> Profile
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm mt-2">
                <div>
                  <div className="text-base-content/60 text-xs">Name</div>
                  <div className="font-medium">{session.user?.name || "—"}</div>
                </div>
                <div>
                  <div className="text-base-content/60 text-xs">Email</div>
                  <div className="font-medium">{session.user?.email || "—"}</div>
                </div>
                <div>
                  <div className="text-base-content/60 text-xs">Role</div>
                  <div className="font-medium capitalize">{session.user?.role || "—"}</div>
                </div>
              </div>
            </div>
          </section>

          <section className="card bg-base-100 border border-base-300">
            <div className="card-body">
              <h2 className="card-title text-base flex items-center gap-2">
                <Shield className="h-4 w-4" /> Modes
              </h2>
              <p className="text-xs text-base-content/60">
                Enable the workspaces you need. You can switch any time.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                {MODES.map((m) => {
                  const active = modes.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      onClick={() => toggleMode(m.id)}
                      className={`p-4 rounded-xl border-2 text-left transition-all ${
                        active ? "border-primary bg-primary/5" : "border-base-300 hover:border-base-content/30"
                      }`}
                    >
                      <div className="font-semibold">{m.label}</div>
                      <div className="text-xs text-base-content/60 mt-1">
                        {active ? "Enabled" : "Disabled"}
                      </div>
                    </button>
                  );
                })}
              </div>
              {isAdmin && (
                <p className="text-xs text-warning mt-3">
                  Admin accounts have access to all modes by default.
                </p>
              )}
              <div className="flex items-center gap-3 mt-4">
                <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
                  {saving ? <span className="loading loading-spinner loading-xs" /> : "Save changes"}
                </button>
                {message && <span className="text-xs text-base-content/70">{message}</span>}
              </div>
            </div>
          </section>

          <section className="card bg-base-100 border border-base-300">
            <div className="card-body">
              <h2 className="card-title text-base flex items-center gap-2">
                <Plug className="h-4 w-4" /> Platforms
              </h2>
              <p className="text-xs text-base-content/60">
                Connect or disconnect LinkedIn, Rozee.pk or Indeed accounts.
              </p>
              <div className="mt-3">
                <Link href="/dashboard/platforms" className="btn btn-outline btn-sm">
                  Manage platforms
                </Link>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
