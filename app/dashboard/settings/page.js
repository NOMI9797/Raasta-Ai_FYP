"use client";

import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  User,
  Layers,
  Lock,
  Palette,
  Bell,
  Plug,
  LogOut,
  Briefcase,
  TrendingUp,
  Sun,
  Moon,
  Check,
  Eye,
  EyeOff,
} from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import { DARK_THEME, LIGHT_THEME, getTheme, onThemeChange, setTheme } from "@/components/layout/theme";

const MODES = [
  {
    id: "recruiter",
    label: "Recruiter",
    icon: Briefcase,
    description: "Jobs, AI screening, candidates and the hiring pipeline.",
  },
  {
    id: "sales",
    label: "Sales",
    icon: TrendingUp,
    description: "Campaigns, leads, LinkedIn outreach and the lead scraper.",
  },
];

const THEMES = [
  { id: LIGHT_THEME, label: "Light", icon: Sun },
  { id: DARK_THEME, label: "Dark", icon: Moon },
];

function Section({ icon: Icon, title, description, children }) {
  return (
    <section className="card bg-base-100 border border-base-300">
      <div className="card-body p-5 gap-4">
        <div>
          <h2 className="card-title text-base flex items-center gap-2">
            <Icon className="h-4 w-4 text-primary" /> {title}
          </h2>
          {description && <p className="text-sm text-base-content/60 mt-1">{description}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

async function sendJson(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

function ProfileSection({ session, update }) {
  const savedName = session.user?.name || "";
  const [name, setName] = useState(savedName);
  const [saving, setSaving] = useState(false);
  const isAdmin = session.user?.role === "admin";
  const dirty = name.trim() !== savedName;

  useEffect(() => setName(savedName), [savedName]);

  const save = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      await sendJson("/api/user/profile", "PATCH", { name });
      await update();
      toast.success("Profile updated");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section icon={User} title="Profile" description="How you appear across Raasta-AI.">
      <form onSubmit={save} className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center text-lg font-bold shrink-0">
            {(savedName || session.user?.email || "?").charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="font-semibold truncate">{savedName || "—"}</p>
            <p className="text-sm text-base-content/60 truncate">{session.user?.email}</p>
            <span className={`badge badge-sm mt-1 ${isAdmin ? "badge-warning" : "badge-ghost"}`}>
              {isAdmin ? "Admin" : "Member"}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-x-4 gap-y-2 items-start">
          <div className="form-control">
            <label className="label pt-0" htmlFor="settings-name">
              <span className="label-text font-medium">Full name</span>
            </label>
            <input
              id="settings-name"
              className="input input-bordered input-sm w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              autoComplete="name"
            />
          </div>
          <div className="form-control">
            <label className="label pt-0" htmlFor="settings-email">
              <span className="label-text font-medium">Email</span>
            </label>
            <input
              id="settings-email"
              className="input input-bordered input-sm w-full"
              value={session.user?.email || ""}
              disabled
              aria-describedby="settings-email-hint"
            />
            <label className="label">
              <span id="settings-email-hint" className="label-text-alt text-base-content/60">
                Contact support to change your sign-in email.
              </span>
            </label>
          </div>
          {/* Aligned with the inputs (below their labels) on desktop */}
          <div className="flex justify-end gap-2 md:pt-9">
            {dirty && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setName(savedName)}>
                Cancel
              </button>
            )}
            <button type="submit" className="btn btn-primary btn-sm" disabled={!dirty || saving}>
              {saving && <span className="loading loading-spinner loading-xs" />}
              Save profile
            </button>
          </div>
        </div>
      </form>
    </Section>
  );
}

function WorkspacesSection({ session, update }) {
  const savedModes = Array.isArray(session.user?.modes) ? session.user.modes : [];
  const savedKey = [...savedModes].sort().join(",");
  const [modes, setModes] = useState(savedModes);
  const [saving, setSaving] = useState(false);
  const isAdmin = session.user?.role === "admin";
  const dirty = [...modes].sort().join(",") !== savedKey;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setModes(savedModes), [savedKey]);

  const toggle = (id) =>
    setModes((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));

  const save = async () => {
    if (modes.length === 0) {
      toast.error("Keep at least one workspace enabled");
      return;
    }
    setSaving(true);
    try {
      await sendJson("/api/user/modes", "POST", { modes });
      await update();
      toast.success("Workspaces updated");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      icon={Layers}
      title="Workspaces"
      description="Choose which parts of Raasta-AI appear in your sidebar."
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {MODES.map(({ id, label, icon: Icon, description }) => {
          const active = modes.includes(id);
          return (
            <button
              key={id}
              type="button"
              role="switch"
              aria-checked={active}
              onClick={() => toggle(id)}
              className={`p-4 rounded-xl border-2 text-left transition-all flex gap-3 ${
                active ? "border-primary bg-primary/5" : "border-base-300 hover:border-base-content/30"
              }`}
            >
              <span className={`p-2 rounded-lg h-fit ${active ? "bg-primary text-primary-content" : "bg-base-200"}`}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{label}</span>
                  <input
                    type="checkbox"
                    className="toggle toggle-primary toggle-sm pointer-events-none"
                    checked={active}
                    readOnly
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                </span>
                <span className="block text-xs text-base-content/60 mt-1">{description}</span>
              </span>
            </button>
          );
        })}
      </div>
      {isAdmin && (
        <p className="text-xs text-base-content/60">
          As an admin you can open every workspace; these switches only control your sidebar.
        </p>
      )}
      <div className="flex justify-end gap-2">
        {dirty && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModes(savedModes)}>
            Cancel
          </button>
        )}
        <button className="btn btn-primary btn-sm" onClick={save} disabled={!dirty || saving}>
          {saving && <span className="loading loading-spinner loading-xs" />}
          Save workspaces
        </button>
      </div>
    </Section>
  );
}

function PasswordField({ id, label, value, onChange, autoComplete, show, hint }) {
  return (
    <div className="form-control">
      <label className="label pt-0" htmlFor={id}>
        <span className="label-text font-medium">{label}</span>
      </label>
      <input
        id={id}
        type={show ? "text" : "password"}
        className="input input-bordered input-sm w-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint && (
        <label className="label">
          <span id={`${id}-hint`} className="label-text-alt text-base-content/60">{hint}</span>
        </label>
      )}
    </div>
  );
}

function SecuritySection({ session, update }) {
  const hasPassword = session.user?.hasPassword !== false;
  const empty = { current: "", next: "", confirm: "" };
  const [form, setForm] = useState(empty);
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (field) => (value) => setForm((f) => ({ ...f, [field]: value }));

  const save = async (e) => {
    e.preventDefault();
    if (form.next.length < 8) {
      toast.error("New password must be at least 8 characters long");
      return;
    }
    if (form.next !== form.confirm) {
      toast.error("New passwords don't match");
      return;
    }
    setSaving(true);
    try {
      await sendJson("/api/user/password", "POST", {
        currentPassword: form.current,
        newPassword: form.next,
      });
      setForm(empty);
      await update();
      toast.success(hasPassword ? "Password changed" : "Password set");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      icon={Lock}
      title={hasPassword ? "Change password" : "Set a password"}
      description={
        hasPassword
          ? "Use at least 8 characters. You'll stay signed in on this device."
          : "You signed up with Google. Add a password to also sign in with your email."
      }
    >
      <form onSubmit={save} className="space-y-2">
        <div className={`grid grid-cols-1 sm:grid-cols-2 ${hasPassword ? "lg:grid-cols-3" : ""} gap-x-4 items-start`}>
          {hasPassword && (
            <PasswordField
              id="settings-current-password"
              label="Current password"
              value={form.current}
              onChange={set("current")}
              autoComplete="current-password"
              show={show}
            />
          )}
          <PasswordField
            id="settings-new-password"
            label="New password"
            value={form.next}
            onChange={set("next")}
            autoComplete="new-password"
            show={show}
            hint="At least 8 characters"
          />
          <PasswordField
            id="settings-confirm-password"
            label="Confirm new password"
            value={form.confirm}
            onChange={set("confirm")}
            autoComplete="new-password"
            show={show}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <button type="button" className="btn btn-ghost btn-sm gap-1" onClick={() => setShow((s) => !s)}>
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {show ? "Hide passwords" : "Show passwords"}
          </button>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={saving || !form.next || !form.confirm || (hasPassword && !form.current)}
          >
            {saving && <span className="loading loading-spinner loading-xs" />}
            {hasPassword ? "Change password" : "Set password"}
          </button>
        </div>
      </form>
    </Section>
  );
}

function AppearanceSection() {
  const [theme, setThemeState] = useState(LIGHT_THEME);

  useEffect(() => {
    setThemeState(getTheme());
    return onThemeChange(setThemeState);
  }, []);

  return (
    <Section icon={Palette} title="Appearance" description="Saved on this device.">
      <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Theme">
        {THEMES.map(({ id, label, icon: Icon }) => {
          const active = theme === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(id)}
              className={`p-3 rounded-xl border-2 flex items-center gap-2 transition-all ${
                active ? "border-primary bg-primary/5" : "border-base-300 hover:border-base-content/30"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="font-medium flex-1 text-left">{label}</span>
              {active && <Check className="h-4 w-4 text-primary" />}
            </button>
          );
        })}
      </div>
    </Section>
  );
}

function NotificationsSection() {
  const queryClient = useQueryClient();
  const [clearing, setClearing] = useState(false);

  const markAllRead = async () => {
    setClearing(true);
    try {
      const { updated } = await sendJson("/api/notifications", "PATCH", {});
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success(updated ? `Marked ${updated} notification${updated === 1 ? "" : "s"} as read` : "You're all caught up");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setClearing(false);
    }
  };

  return (
    <Section
      icon={Bell}
      title="Notifications"
      description="In-app alerts in the bell at the top of every page."
    >
      <ul className="text-sm space-y-1.5 text-base-content/80">
        <li>• Someone applies to one of your jobs</li>
        <li>• AI screening finishes for a job</li>
        <li>• An agent run finishes, fails or needs your approval</li>
      </ul>
      <div className="flex justify-end">
        <button className="btn btn-outline btn-sm" onClick={markAllRead} disabled={clearing}>
          {clearing && <span className="loading loading-spinner loading-xs" />}
          Mark all as read
        </button>
      </div>
    </Section>
  );
}

export default function SettingsPage() {
  const { data: session, status, update } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;
    if (!session) router.push("/signin");
  }, [session, status, router]);

  return (
    <DashboardShell title="Settings" activeSection="settings">
      {status === "loading" || !session ? (
        <div className="flex items-center justify-center py-24">
          <span className="loading loading-spinner loading-lg text-primary" />
        </div>
      ) : (
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
          <div>
            <h1 className="text-2xl font-bold">Settings</h1>
            <p className="text-sm text-base-content/70 mt-1">
              Manage your profile, workspaces, security and preferences.
            </p>
          </div>

          {/* Account settings on the left, preferences on the right on wide screens */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
            <div className="xl:col-span-2 space-y-6">
              <ProfileSection session={session} update={update} />
              <WorkspacesSection session={session} update={update} />
              <SecuritySection session={session} update={update} />
            </div>

            <div className="space-y-6">
              <AppearanceSection />
              <NotificationsSection />

              <Section
                icon={Plug}
                title="Connected platforms"
                description="Connect or disconnect your LinkedIn and Rozee.pk accounts."
              >
                <div>
                  <Link href="/dashboard/platforms" className="btn btn-outline btn-sm">
                    Manage platforms
                  </Link>
                </div>
              </Section>

              <Section icon={LogOut} title="Session" description={`Signed in as ${session.user?.email}.`}>
                <div>
                  <button className="btn btn-outline btn-error btn-sm gap-2" onClick={() => signOut({ callbackUrl: "/" })}>
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                </div>
              </Section>
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
