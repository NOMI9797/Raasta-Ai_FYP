"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, Users, Gauge, Star, Mic, Trophy, AlertCircle } from "lucide-react";

const SOURCE_LABELS = { direct: "Apply page", linkedin: "LinkedIn", rozee: "Rozee.pk", indeed: "Indeed" };

export function useHiringAnalytics() {
  return useQuery({
    queryKey: ["hiring-analytics"],
    queryFn: async () => {
      const res = await fetch("/api/hiring/analytics");
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Failed to load hiring analytics");
      return data.analytics;
    },
    staleTime: 60 * 1000,
  });
}

function StatCard({ icon: Icon, label, value, hint, tone = "text-primary bg-primary/10" }) {
  return (
    <div className="bg-base-200 rounded-xl border border-base-300 p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${tone}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-base-content/60">{label}</p>
          <p className="text-2xl font-bold leading-tight">{value}</p>
        </div>
      </div>
      {hint && <p className="text-xs text-base-content/50 mt-2">{hint}</p>}
    </div>
  );
}

function Section({ title, children, action }) {
  return (
    <section className="bg-base-100 rounded-xl border border-base-300 p-5">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Skeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="skeleton h-24 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="skeleton h-64 rounded-xl" />
        <div className="skeleton h-64 rounded-xl" />
      </div>
    </div>
  );
}

export default function HiringAnalytics() {
  const { data, isLoading, error } = useHiringAnalytics();

  if (isLoading) return <Skeleton />;
  if (error) {
    return (
      <div className="alert alert-error" role="alert">
        <AlertCircle className="h-5 w-5" />
        <span>{error.message}</span>
      </div>
    );
  }

  const { totals, stages, sources, timeline, byJob } = data;

  if (totals.jobs === 0) {
    return (
      <div className="text-center py-16 bg-base-200 rounded-xl border border-base-300">
        <Briefcase className="h-10 w-10 text-base-content/30 mx-auto mb-3" />
        <p className="font-semibold">No hiring data yet</p>
        <p className="text-sm text-base-content/60 mt-1">Create a job and share its apply link to start collecting applicants.</p>
        <Link href="/dashboard/recruiter/jobs" className="btn btn-primary btn-sm mt-4">
          Go to Jobs
        </Link>
      </div>
    );
  }

  const funnel = [
    { label: "Applied", value: totals.applied },
    { label: "Screened", value: totals.screened },
    { label: "Shortlisted", value: totals.shortlisted },
    { label: "Interviewed", value: totals.interviewed },
    { label: "Final shortlist", value: totals.final },
    { label: "Hired", value: totals.hired },
  ];
  const funnelMax = Math.max(1, totals.applied);
  const timelineMax = Math.max(1, ...timeline.map((d) => d.applications));
  const sourceTotal = Math.max(1, sources.reduce((n, s) => n + s.count, 0));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard icon={Briefcase} label="Jobs" value={totals.jobs} hint={`${totals.publishedJobs} published`} />
        <StatCard icon={Users} label="Applicants" value={totals.applied} tone="text-info bg-info/10" />
        <StatCard
          icon={Gauge}
          label="Avg. fit score"
          value={totals.avgFitScore ?? "—"}
          hint={`${totals.screened} screened`}
          tone="text-secondary bg-secondary/10"
        />
        <StatCard
          icon={Star}
          label="Shortlist rate"
          value={`${totals.shortlistRate}%`}
          hint="of screened candidates"
          tone="text-success bg-success/10"
        />
        <StatCard
          icon={Trophy}
          label="Hired"
          value={totals.hired}
          hint={`${totals.hireRate}% of applicants`}
          tone="text-accent bg-accent/10"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Hiring funnel">
          <ul className="space-y-3">
            {funnel.map((step, i) => {
              const prev = i > 0 ? funnel[i - 1].value : null;
              const conversion = prev ? Math.round((step.value / prev) * 100) : null;
              return (
                <li key={step.label}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{step.label}</span>
                    <span className="font-medium">
                      {step.value}
                      {conversion != null && (
                        <span className="text-xs text-base-content/50 ml-2">{conversion}% of previous</span>
                      )}
                    </span>
                  </div>
                  <div className="h-2.5 bg-base-300 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${(step.value / funnelMax) * 100}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>

        <Section title="Applications, last 14 days">
          <div className="flex items-end gap-1 h-48" role="img" aria-label="Applications per day for the last 14 days">
            {timeline.map((d) => (
              <div key={d.date} className="flex-1 flex flex-col items-center justify-end h-full group">
                <span className="text-[10px] text-base-content/60 opacity-0 group-hover:opacity-100 mb-1">
                  {d.applications}
                </span>
                <div
                  className="w-full bg-primary/80 group-hover:bg-primary rounded-t transition-all"
                  style={{ height: `${Math.max(d.applications ? 4 : 1, (d.applications / timelineMax) * 100)}%` }}
                  title={`${d.date}: ${d.applications} application${d.applications === 1 ? "" : "s"}`}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-base-content/50 mt-2">
            <span>{timeline[0]?.date}</span>
            <span>{timeline.at(-1)?.date}</span>
          </div>
        </Section>

        <Section title="Candidates by stage">
          <div className="grid grid-cols-3 gap-3">
            {stages.map((s) => (
              <div key={s.stage} className="bg-base-200 rounded-lg p-3 text-center border border-base-300">
                <p className="text-xl font-bold">{s.count}</p>
                <p className="text-xs text-base-content/60">{s.label}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Where applicants come from">
          {sources.length === 0 ? (
            <p className="text-sm text-base-content/60">No applicants yet.</p>
          ) : (
            <ul className="space-y-3">
              {sources.map((s) => (
                <li key={s.source}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{SOURCE_LABELS[s.source] || s.source}</span>
                    <span className="font-medium">
                      {s.count} <span className="text-xs text-base-content/50">({Math.round((s.count / sourceTotal) * 100)}%)</span>
                    </span>
                  </div>
                  <div className="h-2 bg-base-300 rounded-full overflow-hidden">
                    <div className="h-full bg-secondary rounded-full" style={{ width: `${(s.count / sourceTotal) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="By job">
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Job</th>
                <th className="text-right">Applied</th>
                <th className="text-right">Shortlisted</th>
                <th className="text-right">Interviewed</th>
                <th className="text-right">Hired</th>
                <th className="text-right">Avg. fit</th>
              </tr>
            </thead>
            <tbody>
              {byJob.map((j) => (
                <tr key={j.jobId} className="hover">
                  <td>
                    <Link href={`/dashboard/recruiter/jobs/${j.jobId}/candidates`} className="link link-hover font-medium">
                      {j.title}
                    </Link>
                    <span className="badge badge-ghost badge-xs ml-2">{j.status}</span>
                  </td>
                  <td className="text-right">{j.applied}</td>
                  <td className="text-right">{j.shortlisted}</td>
                  <td className="text-right">
                    <span className="inline-flex items-center gap-1">
                      <Mic className="h-3 w-3 text-base-content/40" />
                      {j.interviewed}
                    </span>
                  </td>
                  <td className="text-right">{j.hired}</td>
                  <td className="text-right">{j.avgFitScore ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
