"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Building2, Loader2, Plus, User } from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import { PLATFORM_META, PLATFORM_ORDER } from "@/libs/platforms/meta";
import { PLATFORM_KIND, SALES_STAGES, getStage, nextStage, stageHref } from "@/libs/sales/stages";

const LAST_CAMPAIGN_KEY = "sales:lastCampaign";

function readLastCampaign() {
  try {
    return window.localStorage.getItem(LAST_CAMPAIGN_KEY);
  } catch {
    return null;
  }
}

function rememberCampaign(id) {
  try {
    window.localStorage.setItem(LAST_CAMPAIGN_KEY, id);
  } catch {
    /* private mode: just don't remember */
  }
}

export function campaignPlatforms(campaign) {
  const sources = Array.isArray(campaign?.sources) && campaign.sources.length ? campaign.sources : ["linkedin"];
  return PLATFORM_ORDER.filter((id) => sources.includes(id));
}

/** The steps in a row; the current one is highlighted. Links keep the selected campaign. */
function StepBar({ current, campaignId }) {
  return (
    <ol className="flex flex-wrap gap-1.5" aria-label="Sales steps">
      {SALES_STAGES.map((stage) => {
        const active = stage.key === current;
        return (
          <li key={stage.key}>
            <Link
              href={stageHref(stage.key, { campaignId })}
              aria-current={active ? "step" : undefined}
              className={`btn btn-xs !normal-case gap-1.5 rounded-full ${
                active ? "btn-primary" : "btn-ghost bg-base-200 text-base-content/70"
              }`}
            >
              <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${
                active ? "bg-primary-content text-primary" : "bg-base-300"
              }`}>
                {stage.step}
              </span>
              {stage.label}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

function PlatformTabs({ platforms, value, onChange }) {
  return (
    <div role="tablist" className="tabs tabs-boxed bg-base-200 w-fit">
      {platforms.map((id) => {
        const meta = PLATFORM_META[id];
        const KindIcon = PLATFORM_KIND[id] === "company" ? Building2 : User;
        return (
          <button
            key={id}
            role="tab"
            aria-selected={value === id}
            className={`tab gap-2 ${value === id ? "tab-active" : ""}`}
            onClick={() => onChange(id)}
          >
            <span className={`inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold text-white ${meta.accent}`}>
              {meta.initials}
            </span>
            {meta.label}
            <span className="hidden sm:inline-flex items-center gap-1 text-xs opacity-60">
              <KindIcon className="h-3 w-3" />
              {PLATFORM_KIND[id] === "company" ? "Companies" : "People"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ShellInner({ stageKey, requireCampaign = true, children }) {
  const stage = getStage(stageKey);
  const next = nextStage(stageKey);
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [campaigns, setCampaigns] = useState([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/");
      return;
    }
    const modes = Array.isArray(session.user?.modes) ? session.user.modes : [];
    if (session.user?.role !== "admin" && !modes.includes("sales")) router.replace("/dashboard/home");
  }, [session, status, router]);

  const loadCampaigns = useCallback(async () => {
    try {
      const res = await fetch("/api/campaigns");
      const data = await res.json();
      if (res.ok) setCampaigns(data.campaigns || []);
    } finally {
      setLoadingCampaigns(false);
    }
  }, []);

  useEffect(() => {
    if (!requireCampaign) setLoadingCampaigns(false);
    else if (session) loadCampaigns();
  }, [session, requireCampaign, loadCampaigns]);

  // Selected campaign: ?campaign=, else the last one used, else the newest
  const campaignParam = searchParams.get("campaign");
  const campaign = useMemo(() => {
    if (!campaigns.length) return null;
    const byId = (id) => campaigns.find((c) => c.id === id);
    return byId(campaignParam) || (typeof window !== "undefined" && byId(readLastCampaign())) || campaigns[0];
  }, [campaigns, campaignParam]);

  const platforms = useMemo(() => campaignPlatforms(campaign), [campaign]);
  const platformParam = searchParams.get("platform");
  const platform = platforms.includes(platformParam) ? platformParam : platforms[0];

  const setQuery = useCallback(
    (changes) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(changes).forEach(([k, v]) => (v ? params.set(k, v) : params.delete(k)));
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    if (campaign) rememberCampaign(campaign.id);
  }, [campaign]);

  const selectCampaign = (id) => setQuery({ campaign: id, platform: null });

  if (status === "loading" || !session || !stage) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const ctx = { campaign, campaigns, platform, platforms, reloadCampaigns: loadCampaigns, setPlatform: (p) => setQuery({ campaign: campaign?.id, platform: p }) };

  return (
    <DashboardShell title={stage.label} activeSection={`sales-${stage.key}`}>
      <div className="p-4 md:p-6 space-y-5 max-w-7xl">
        <StepBar current={stage.key} campaignId={campaign?.id} />

        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              Step {stage.step} of {SALES_STAGES.length}
            </p>
            <h1 className="text-2xl font-bold">{stage.label}</h1>
            <p className="text-sm text-base-content/70 mt-1">{stage.summary}</p>
          </div>
          {requireCampaign && campaigns.length > 0 && (
            <label className="form-control w-full sm:w-72">
              <span className="label-text text-xs mb-1">Campaign</span>
              <select
                className="select select-bordered select-sm"
                value={campaign?.id || ""}
                onChange={(e) => selectCampaign(e.target.value)}
              >
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </header>

        {!requireCampaign ? (
          children(ctx)
        ) : loadingCampaigns ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
          </div>
        ) : !campaign ? (
          <div className="rounded-xl border border-dashed border-base-300 p-10 text-center">
            <p className="font-semibold">No campaigns yet</p>
            <p className="text-sm text-base-content/60 mt-1">Every step works inside a campaign. Create one first.</p>
            <Link href={stageHref("campaigns")} className="btn btn-primary btn-sm mt-4 gap-1">
              <Plus className="h-4 w-4" /> Create a campaign
            </Link>
          </div>
        ) : (
          <>
            <PlatformTabs platforms={platforms} value={platform} onChange={ctx.setPlatform} />
            {children(ctx)}
          </>
        )}

        {next && (!requireCampaign || campaign) && (
          <div className="flex justify-end border-t border-base-300 pt-4">
            <Link href={stageHref(next.key, { campaignId: campaign?.id, platform })} className="btn btn-sm btn-outline gap-1 !normal-case">
              Next: {next.label} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

/**
 * Layout for a sales step page. `children` is a function that receives
 * { campaign, campaigns, platform, platforms, setPlatform, reloadCampaigns }.
 */
export default function SalesStageShell(props) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-base-100 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <ShellInner {...props} />
    </Suspense>
  );
}
