"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  Bot,
  Briefcase,
  CheckCircle2,
  Clock,
  Gavel,
  Hourglass,
  MessageSquare,
  Mic,
  Plug,
  RefreshCw,
  Send,
  Settings,
  Target,
  UserCheck,
  Users,
} from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import { useSystemStatus } from "@/components/system/useSystem";
import {
  markNotificationsRead,
  metaFor,
  notificationKeys,
  timeAgo,
  useNotificationFeed,
  useNow,
} from "@/components/layout/notification-utils";

const OVERVIEW_KEY = ["dashboard-overview"];

async function fetchOverview() {
  const res = await fetch("/api/dashboard/overview", { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Couldn't load your overview");
  return data;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const percent = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
const formatDate = (value) => new Date(value).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

const JOB_BADGE = { published: "badge-success", draft: "badge-ghost", closed: "badge-neutral" };
const CAMPAIGN_BADGE = { active: "badge-success", draft: "badge-ghost", completed: "badge-info" };

function greeting(hour) {
  if (hour == null) return "Welcome back";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function HomePage() {
  const { data: session, status: sessionStatus } = useSession();
  const [today, setToday] = useState(null); // set after mount: the server's clock and time zone aren't the reader's

  useEffect(() => setToday(new Date()), []);

  const modes = Array.isArray(session?.user?.modes) ? session.user.modes : [];
  const isAdmin = session?.user?.role === "admin";
  const sessionRecruiter = isAdmin || modes.includes("recruiter");
  const sessionSales = isAdmin || modes.includes("sales");

  const overview = useQuery({
    queryKey: OVERVIEW_KEY,
    queryFn: fetchOverview,
    enabled: sessionStatus === "authenticated",
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
    staleTime: 15 * 1000,
  });
  const { recruiter, sales } = overview.data || {};
  const loading = sessionStatus === "loading" || overview.isLoading;

  const firstName = session?.user?.name?.split(" ")[0];
  const workspaces = [sessionRecruiter && "Recruiter", sessionSales && "Sales"].filter(Boolean);

  return (
    <DashboardShell title="Home" activeSection="home">
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">
              {greeting(today?.getHours())}
              {firstName ? `, ${firstName}` : ""}
            </h1>
            <p className="text-sm text-base-content/70 mt-1">
              {today && `${today.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })} · `}
              {isAdmin ? "Admin overview of every workspace" : workspaces.length ? `${workspaces.join(" & ")} workspace` : "Welcome to Raasta-AI"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {sessionRecruiter && (
              <Link href="/dashboard/recruiter/jobs" className="btn btn-primary btn-sm gap-2">
                <Briefcase className="h-4 w-4" /> Jobs
              </Link>
            )}
            {sessionSales && (
              <Link href="/dashboard/sales/campaigns" className={`btn btn-sm gap-2 ${sessionRecruiter ? "btn-outline" : "btn-primary"}`}>
                <Target className="h-4 w-4" /> Campaigns
              </Link>
            )}
          </div>
        </div>

        {sessionRecruiter && <SystemBanner />}

        {overview.isError && (
          <div className="alert alert-error" role="alert">
            <AlertTriangle className="h-5 w-5" />
            <span>{overview.error.message}. The numbers below may be missing.</span>
            <button className="btn btn-sm btn-ghost gap-1" onClick={() => overview.refetch()} disabled={overview.isFetching}>
              <RefreshCw className={`h-4 w-4 ${overview.isFetching ? "animate-spin" : ""}`} /> Retry
            </button>
          </div>
        )}

        {/* While loading show skeletons; afterwards only the workspaces the server says this user has */}
        {sessionRecruiter && (loading || recruiter) && <HiringSection data={recruiter} loading={loading} />}
        {sessionSales && (loading || sales) && <SalesSection data={sales} loading={loading} />}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2">
            <ActivityCard />
          </div>
          <ShortcutsCard showRecruiter={sessionRecruiter} showSales={sessionSales} />
        </div>
      </div>
    </DashboardShell>
  );
}

/* ---------- shared pieces ---------- */

function Card({ title, icon: Icon, action, children, className = "" }) {
  return (
    <section className={`card bg-base-100 border border-base-300 ${className}`}>
      <div className="card-body p-5 gap-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold flex items-center gap-2">
            {Icon && <Icon className="h-4 w-4 text-primary" />} {title}
          </h2>
          {action}
        </div>
        {children}
      </div>
    </section>
  );
}

function SectionTitle({ children }) {
  return <h2 className="text-xs font-semibold uppercase tracking-wider text-base-content/60">{children}</h2>;
}

function StatCard({ icon: Icon, label, value, sub, href, tone = "text-base-content", loading }) {
  const body = (
    <div className="card-body p-4 gap-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-base-200 rounded-lg flex items-center justify-center shrink-0">
          <Icon className="h-5 w-5 text-base-content/70" />
        </div>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-base-content/60 truncate">{label}</div>
          {loading ? (
            <div className="skeleton h-8 w-14 mt-1" />
          ) : (
            <div className={`text-2xl font-bold leading-tight ${tone}`}>{value}</div>
          )}
        </div>
      </div>
      {loading ? <div className="skeleton h-3 w-24" /> : <p className="text-xs text-base-content/60 truncate">{sub}</p>}
    </div>
  );
  const classes = "card bg-base-100 border border-base-300";
  return href ? (
    <Link href={href} className={`${classes} hover:border-primary/40 hover:shadow-sm transition`}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}

function SystemBanner() {
  const system = useSystemStatus({ enabled: true, interval: 20000 }); // same request the sidebar already makes
  const status = system.data?.status;
  if (!status || status.overall === "ready") return null;
  const blocked = status.overall === "blocked";
  return (
    <div className={`alert ${blocked ? "alert-error" : "alert-warning"}`} role="status">
      <AlertTriangle className="h-5 w-5" />
      <div>
        <p className="font-medium">{blocked ? "The hiring pipeline can't run right now" : "Part of the hiring pipeline is off"}</p>
        <p className="text-sm">{status.summary}</p>
      </div>
      <Link href="/dashboard/recruiter/setup" className="btn btn-sm btn-ghost gap-1">
        Open setup guide <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

/* ---------- hiring ---------- */

function HiringSection({ data, loading }) {
  const people = data?.candidates;
  return (
    <div className="space-y-4">
      <SectionTitle>Hiring</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          icon={Briefcase}
          label="Open jobs"
          value={data?.jobs.open ?? 0}
          sub={data && `${data.jobs.total} in total${data.jobs.draft ? ` · ${data.jobs.draft} draft` : ""}`}
          href="/dashboard/recruiter/jobs"
          loading={loading}
        />
        <StatCard
          icon={Users}
          label="Candidates"
          value={people?.total ?? 0}
          sub={people && (people.newThisWeek ? `${people.newThisWeek} new this week` : "None new this week")}
          href="/dashboard/recruiter/candidates"
          loading={loading}
        />
        <StatCard
          icon={Mic}
          label="In interview"
          value={people?.interviewing ?? 0}
          sub={people && (people.awaitingDecision ? `${people.awaitingDecision} done, waiting for you` : "Invited or interviewing now")}
          href="/dashboard/recruiter/interviews"
          loading={loading}
        />
        <StatCard
          icon={UserCheck}
          label="Final shortlist"
          value={people?.funnel.final ?? 0}
          sub={people && `${people.hired} hired`}
          tone="text-success"
          href="/dashboard/recruiter/decisions"
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <AttentionCard data={data} loading={loading} />
        <FunnelCard funnel={people?.funnel} loading={loading} className="lg:col-span-2" />
      </div>

      <RecentJobsCard jobs={data?.recentJobs} loading={loading} />
    </div>
  );
}

function AttentionCard({ data, loading }) {
  const people = data?.candidates;
  const items = data
    ? [
        { n: data.pendingApprovals, text: (n) => `${plural(n, "agent request", "agent requests")} to approve`, href: "/dashboard/recruiter/decisions", icon: Bot, tone: "text-warning bg-warning/10" },
        { n: people.awaitingDecision, text: (n) => `${plural(n, "interview", "interviews")} waiting for your decision`, href: "/dashboard/recruiter/decisions", icon: Gavel, tone: "text-accent bg-accent/10" },
        { n: people.waitingForShortlist, text: (n) => `${plural(n, "screened candidate", "screened candidates")} to shortlist`, href: "/dashboard/recruiter/candidates", icon: UserCheck, tone: "text-primary bg-primary/10" },
        { n: people.expiredInvites, text: (n) => `${plural(n, "interview invite", "interview invites")} expired`, href: "/dashboard/recruiter/interviews", icon: Clock, tone: "text-error bg-error/10" },
        { n: people.unscreened, text: (n) => `${plural(n, "new application", "new applications")} waiting to be screened`, href: "/dashboard/recruiter/candidates", icon: Hourglass, tone: "text-info bg-info/10" },
      ].filter((item) => item.n > 0)
    : [];

  return (
    <Card title="Needs your attention" icon={AlertTriangle}>
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-10 w-full" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="flex items-center gap-3 text-sm">
          <CheckCircle2 className="h-8 w-8 text-success shrink-0" />
          <div>
            <p className="font-medium">You&apos;re all caught up</p>
            <p className="text-xs text-base-content/60">Nothing is waiting on you right now.</p>
          </div>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {items.map(({ n, text, href, icon: Icon, tone }) => (
            <li key={text(n)}>
              <Link href={href} className="flex items-center gap-3 p-2 -mx-2 rounded-lg hover:bg-base-200 transition-colors group">
                <span className={`p-2 rounded-lg ${tone}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="flex-1 text-sm">{text(n)}</span>
                <ArrowRight className="h-4 w-4 text-base-content/30 group-hover:text-base-content/70 transition-colors" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const FUNNEL_STAGES = [
  { key: "applied", label: "Applied", bar: "bg-base-content/30" },
  { key: "shortlisted", label: "Shortlisted", bar: "bg-primary/60" },
  { key: "interviewed", label: "Interviewed", bar: "bg-accent/70" },
  { key: "final", label: "Final shortlist or hired", bar: "bg-success" },
];

function FunnelCard({ funnel, loading, className }) {
  const applied = funnel?.applied || 0;
  return (
    <Card title="Hiring funnel" icon={BarChart3} className={className} action={<Link href="/dashboard/analytics" className="btn btn-ghost btn-xs gap-1">Analytics <ArrowRight className="h-3 w-3" /></Link>}>
      {loading ? (
        <div className="space-y-4">
          {FUNNEL_STAGES.map((s) => <div key={s.key} className="skeleton h-8 w-full" />)}
        </div>
      ) : applied === 0 ? (
        <p className="text-sm text-base-content/60 py-6 text-center">
          No applications yet. Publish a job and candidates will appear here as they apply.
        </p>
      ) : (
        <ul className="space-y-3">
          {FUNNEL_STAGES.map(({ key, label, bar }) => {
            const count = funnel[key];
            const width = Math.max(percent(count, applied), count > 0 ? 2 : 0);
            return (
              <li key={key}>
                <div className="flex items-baseline justify-between text-sm mb-1">
                  <span>{label}</span>
                  <span className="text-base-content/60">
                    <span className="font-semibold text-base-content">{count}</span> · {percent(count, applied)}%
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-base-200 overflow-hidden" role="presentation">
                  <div className={`h-full rounded-full ${bar} transition-all duration-500`} style={{ width: `${width}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function RecentJobsCard({ jobs, loading }) {
  return (
    <Card title="Recent jobs" icon={Briefcase} action={<Link href="/dashboard/recruiter/jobs" className="btn btn-ghost btn-xs gap-1">All jobs <ArrowRight className="h-3 w-3" /></Link>}>
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-12 w-full" />)}
        </div>
      ) : !jobs?.length ? (
        <div className="py-6 text-center">
          <p className="text-sm font-medium">No jobs yet</p>
          <p className="text-xs text-base-content/60 mt-1 mb-3">Create a job and let the AI write the post, screen the applicants and interview them.</p>
          <Link href="/dashboard/recruiter/jobs" className="btn btn-primary btn-sm">Create your first job</Link>
        </div>
      ) : (
        <div className="overflow-x-auto -mx-2">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Job</th>
                <th className="text-right">Applied</th>
                <th className="text-right hidden sm:table-cell">Shortlisted</th>
                <th className="text-right hidden sm:table-cell">Interviewed</th>
                <th className="text-right hidden md:table-cell">Created</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="hover">
                  <td>
                    <Link href={`/dashboard/recruiter/jobs/${job.id}/candidates`} className="font-medium hover:text-primary">
                      {job.title}
                    </Link>
                    <span className={`badge badge-sm ml-2 ${JOB_BADGE[job.status] || "badge-ghost"}`}>{job.status}</span>
                  </td>
                  <td className="text-right">{job.applied}</td>
                  <td className="text-right hidden sm:table-cell">{job.shortlisted}</td>
                  <td className="text-right hidden sm:table-cell">{job.interviewed}</td>
                  <td className="text-right text-base-content/60 hidden md:table-cell whitespace-nowrap">{formatDate(job.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ---------- sales ---------- */

function SalesSection({ data, loading }) {
  return (
    <div className="space-y-4">
      <SectionTitle>Sales</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          icon={Target}
          label="Campaigns"
          value={data?.campaigns.total ?? 0}
          sub={data && `${data.campaigns.active} active · ${data.campaigns.completed} completed`}
          href="/dashboard/sales/campaigns"
          loading={loading}
        />
        <StatCard icon={Users} label="Leads" value={data?.leads ?? 0} sub={data && "Across all campaigns"} href="/dashboard/sales/leads" loading={loading} />
        <StatCard
          icon={Send}
          label="Invites sent"
          value={data?.invitesSent ?? 0}
          sub={data && (data.invitesSent ? `${data.acceptanceRate}% accepted` : "None sent yet")}
          href="/dashboard/sales/outreach"
          loading={loading}
        />
        <StatCard icon={MessageSquare} label="Messages sent" value={data?.messagesSent ?? 0} sub={data && "AI-written outreach"} tone="text-success" href="/dashboard/sales/outreach" loading={loading} />
      </div>

      <Card title="Recent campaigns" icon={Target} action={<Link href="/dashboard/sales/campaigns" className="btn btn-ghost btn-xs gap-1">All campaigns <ArrowRight className="h-3 w-3" /></Link>}>
        {loading ? (
          <div className="space-y-2">
            {[0, 1].map((i) => <div key={i} className="skeleton h-12 w-full" />)}
          </div>
        ) : !data?.recentCampaigns.length ? (
          <div className="py-6 text-center">
            <p className="text-sm font-medium">No campaigns yet</p>
            <p className="text-xs text-base-content/60 mt-1 mb-3">Start a campaign, add leads and let the AI write the first messages.</p>
            <Link href="/dashboard/sales/campaigns" className="btn btn-primary btn-sm">Create your first campaign</Link>
          </div>
        ) : (
          <ul className="divide-y divide-base-300">
            {data.recentCampaigns.map((c) => (
              <li key={c.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link href="/dashboard/sales/campaigns" className="font-medium hover:text-primary truncate block">{c.name}</Link>
                    <p className="text-xs text-base-content/60">{plural(c.leads, "lead", "leads")} · created {formatDate(c.createdAt)}</p>
                  </div>
                  <span className={`badge badge-sm ${CAMPAIGN_BADGE[c.status] || "badge-ghost"}`}>{c.status}</span>
                </div>
                {c.leads > 0 && (
                  <div className="flex items-center gap-2 mt-2">
                    <progress className="progress progress-primary h-1.5 flex-1" value={c.processed} max={c.leads} />
                    <span className="text-[11px] text-base-content/60 whitespace-nowrap">{c.processed}/{c.leads} processed</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ---------- activity and shortcuts ---------- */

function ActivityCard() {
  const queryClient = useQueryClient();
  const now = useNow();
  const feed = useNotificationFeed();
  const markRead = useMutation({
    mutationFn: markNotificationsRead,
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });
  const items = (feed.data?.notifications || []).slice(0, 6);
  const unread = feed.data?.unread || 0;

  return (
    <Card
      title="Recent activity"
      icon={Bell}
      action={
        <Link href="/dashboard/settings#notifications" className="btn btn-ghost btn-xs gap-1">
          {unread > 0 ? `${unread} unread` : "All notifications"} <ArrowRight className="h-3 w-3" />
        </Link>
      }
    >
      {feed.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-12 w-full" />)}
        </div>
      ) : feed.isError ? (
        <p className="text-sm text-error py-4 text-center">Couldn&apos;t load your activity.</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-base-content/60 py-6 text-center">
          Nothing yet. Applications, screening results, interviews and agent updates will appear here.
        </p>
      ) : (
        <ul className="divide-y divide-base-300">
          {items.map((item) => {
            const { icon: Icon, tone } = metaFor(item.type);
            return (
              <li key={item.id}>
                <Link
                  href={item.link || "/dashboard/settings#notifications"}
                  onClick={() => !item.readAt && markRead.mutate([item.id])}
                  className="flex gap-3 py-3 hover:bg-base-200/60 -mx-2 px-2 rounded-lg transition-colors"
                >
                  <span className={`p-2 rounded-lg h-fit ${tone}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-start justify-between gap-2">
                      <span className={`text-sm ${item.readAt ? "" : "font-semibold"}`}>{item.title}</span>
                      <span className="text-[11px] text-base-content/50 whitespace-nowrap mt-0.5">{timeAgo(item.createdAt, now)}</span>
                    </span>
                    {item.body && <span className="block text-xs text-base-content/60 mt-0.5 line-clamp-1">{item.body}</span>}
                  </span>
                  {!item.readAt && <span className="mt-2 h-2 w-2 rounded-full bg-primary shrink-0" aria-label="Unread" />}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function ShortcutsCard({ showRecruiter, showSales }) {
  const links = [
    showRecruiter && { href: "/dashboard/recruiter/agent", label: "Hiring agent", hint: "Works through applicants and asks before it acts", icon: Bot },
    showSales && { href: "/dashboard/agents", label: "Sales agents", hint: "Automate lead scraping and outreach", icon: Bot },
    { href: "/dashboard/platforms", label: "Platforms", hint: "LinkedIn, Rozee.pk and Indeed accounts", icon: Plug },
    { href: "/dashboard/analytics", label: "Analytics", hint: "Funnels, sources and outreach results", icon: BarChart3 },
    { href: "/dashboard/settings", label: "Settings", hint: "Profile, workspaces and notifications", icon: Settings },
  ].filter(Boolean);

  return (
    <Card title="Shortcuts">
      <ul className="space-y-1">
        {links.map(({ href, label, hint, icon: Icon }) => (
          <li key={href}>
            <Link href={href} className="flex items-center gap-3 p-2 -mx-2 rounded-lg hover:bg-base-200 transition-colors group">
              <span className="p-2 rounded-lg bg-base-200 text-base-content/70">
                <Icon className="h-4 w-4" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-xs text-base-content/60 truncate">{hint}</span>
              </span>
              <ArrowRight className="h-4 w-4 text-base-content/30 group-hover:text-base-content/70 transition-colors" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
