"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { AlertTriangle, CheckCircle2, ClipboardCopy, ExternalLink, Loader2, Save, Send, Sparkles, X } from "lucide-react";
import { useDialog } from "@/components/ui/DialogProvider";
import { ackConfirmations, detectPoster, pollConfirmations, sendKit } from "@/libs/poster-bridge";
import PostingEngine from "./PostingEngine";
import { formatAgo, formatDateTime } from "./format";

const PLATFORMS_PAGE = "/dashboard/platforms";

async function api(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function ConnectionChip({ connection }) {
  if (connection.status === "connected") {
    return <span className="badge badge-sm badge-success badge-outline gap-1"><CheckCircle2 className="h-3 w-3" /> {connection.accountName || "Connected"}</span>;
  }
  if (connection.status === "inactive") {
    return <Link href={PLATFORMS_PAGE} className="badge badge-sm badge-warning badge-outline">Connected but switched off</Link>;
  }
  return <Link href={PLATFORMS_PAGE} className="badge badge-sm badge-ghost">Not connected. Connect</Link>;
}

// Why the automatic Publish button is unavailable (null = available)
function blockedReason(p, text, over) {
  if (!p.autoPost.available) return p.autoPost.reason;
  if (p.connection.status === "not_connected") return `No ${p.label} account is connected.`;
  if (p.connection.status === "inactive") return `Your ${p.label} account is switched off.`;
  if (!text.trim()) return "Write or generate the post first.";
  if (over) return `The post is over the ${p.maxChars} character limit.`;
  if (!p.guard.allowed) return p.guard.reason;
  if (p.latest?.status === "publishing") return "A post is already being published.";
  return null;
}

function PlatformCard({ job, p, text, busy, handoff, poster, onText, onSave, onGenerate, onPublish, onHandoff, onHandoffLink, onConfirmHandoff, onAccount, onSaveFirst, onEngineFinished }) {
  const dirty = text !== p.post.text;
  const over = text.length > p.maxChars;
  const reason = blockedReason(p, text, over);
  const working = (name) => busy === `${name}:${p.id}`;
  const failed = p.latest && ["failed", "needs_login", "unconfirmed"].includes(p.latest.status) && (!p.published || new Date(p.latest.at) > new Date(p.published.at || 0));
  const awaitingHandoff = (handoff || p.latest?.status === "handed_off") && !(p.published && new Date(p.published.at) > new Date(p.latest?.at || 0));

  return (
    <section className="rounded-xl border border-base-300 bg-base-100 p-4 space-y-3" aria-label={p.label}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{p.label}</h3>
        {p.autoPost.available && <ConnectionChip connection={p.connection} />}
        {p.published && (
          <span className="badge badge-sm badge-success gap-1">
            <CheckCircle2 className="h-3 w-3" /> Published {p.published.at ? formatAgo(p.published.at) : ""}
            {p.published.url && (
              <a href={p.published.url} target="_blank" rel="noopener noreferrer" aria-label={`Open the ${p.label} post`}><ExternalLink className="h-3 w-3" /></a>
            )}
          </span>
        )}
      </div>
      <p className="text-xs text-base-content/60">{p.summary}</p>

      {p.autoPost.available && p.connection.accounts.length > 1 && (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-base-content/70">Post with account</span>
          <select
            className="select select-bordered select-sm"
            value={p.connection.accountId || ""}
            onChange={(e) => onAccount(e.target.value)}
            disabled={Boolean(busy)}
          >
            {!p.connection.accountId && <option value="">Choose an account</option>}
            {p.connection.accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}{a.own ? "" : " (team)"}{a.isActive ? "" : " (switched off)"}</option>
            ))}
          </select>
        </label>
      )}

      <div>
        <textarea
          className="textarea textarea-bordered w-full text-sm leading-relaxed min-h-[11rem]"
          value={text}
          onChange={(e) => onText(e.target.value)}
          placeholder={`No ${p.label} post yet. Generate one with AI or write it here.`}
          aria-label={`${p.label} post`}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 mt-1">
          <span className={`text-xs ${over ? "text-error font-semibold" : "text-base-content/50"}`}>{text.length} / {p.maxChars} characters</span>
          <div className="flex gap-1">
            {dirty && (
              <button type="button" className="btn !normal-case btn-ghost btn-xs gap-1" onClick={onSave} disabled={Boolean(busy)}>
                {working("save") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save edits
              </button>
            )}
            <button type="button" className="btn !normal-case btn-ghost btn-xs gap-1" onClick={onGenerate} disabled={Boolean(busy)}>
              {working("generate") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {text.trim() ? "Rewrite with AI" : "Write with AI"}
            </button>
          </div>
        </div>
      </div>

      {failed && (
        <div className="alert alert-warning py-2 text-sm items-start">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p>{p.latest.status === "needs_login" ? `${p.label} asked for a sign-in check, so nothing was posted.` : p.latest.status === "unconfirmed" ? `Check ${p.label} before posting again: it may already be live.` : "The last attempt did not go through."}</p>
            {p.latest.error && <p className="text-xs opacity-80 mt-0.5">{p.latest.error}</p>}
            {p.latest.status === "needs_login" && <Link href={PLATFORMS_PAGE} className="link text-xs">Reconnect the account</Link>}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn !normal-case btn-primary btn-sm gap-1"
          onClick={onPublish}
          disabled={Boolean(busy) || Boolean(reason)}
          title={reason || `Post to the connected ${p.label} account now`}
        >
          {working("publish") ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {p.published ? `Post again to ${p.label}` : `Post to ${p.label}`}
        </button>
        <button
          type="button"
          className="btn !normal-case btn-outline btn-sm gap-1"
          onClick={onHandoff}
          disabled={Boolean(busy) || !text.trim() || over}
          title={`Copies the post and opens ${p.label}, where you press Post yourself`}
        >
          {working("handoff") ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCopy className="h-4 w-4" />}
          Copy and open {p.label}
        </button>
      </div>
      {reason && (p.connection.status === "connected" || !p.autoPost.available) && <p className="text-xs text-base-content/60">{reason}</p>}
      {p.autoPost.available && p.connection.status === "connected" && (
        <p className="text-xs text-base-content/50">Automatic posts in the last 24 hours: {p.guard.usedToday} of {p.guard.dailyCap}</p>
      )}

      {p.assisted && (
        <p className="text-xs text-base-content/60">
          {poster.installed
            ? `Raasta-AI Poster ${poster.version ? `v${poster.version} ` : ""}is connected: Copy and open also sends every field (title, location, pay, description) to the panel it shows beside ${p.label}'s form.`
            : "Tip: the Raasta-AI Poster browser extension shows every field beside the form, with a Copy and a Fill button for each (see extensions/raasta-poster/README.md). Reload this page after installing it."}
        </p>
      )}

      {p.engine?.available && (
        <PostingEngine job={job} platform={p} text={text} over={over} onBeforeStart={onSaveFirst} onFinished={onEngineFinished} />
      )}

      {awaitingHandoff && (
        <div className="rounded-lg bg-base-200 p-3 space-y-2 text-sm">
          <p>Posted it on {p.label}{p.latest?.at ? ` (copied ${formatDateTime(p.latest.at)})` : ""}? Save the link so you can find it later. It is optional.</p>
          <div className="flex flex-wrap gap-2">
            <input
              type="url"
              className="input input-bordered input-sm flex-1 min-w-[12rem]"
              placeholder={`Link to your ${p.label} post`}
              value={handoff?.link || ""}
              onChange={(e) => onHandoffLink(e.target.value)}
              aria-label={`Link to your ${p.label} post`}
            />
            <button type="button" className="btn !normal-case btn-success btn-sm" onClick={onConfirmHandoff} disabled={Boolean(busy)}>
              {working("confirm") ? <Loader2 className="h-4 w-4 animate-spin" /> : "I posted it"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Publish a job to LinkedIn, Rozee.pk and Indeed. Each platform has its own post (written to that platform's format),
 * its own Post button, and a hand-off ("Copy and open") for posting it yourself.
 * `onChanged` is called after anything that changes the job so the list can refresh.
 */
export default function PublishPanel({ job, onClose, onChanged }) {
  const { confirm, alert } = useDialog();
  const dialogRef = useRef(null);
  const [platforms, setPlatforms] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(null); // "<action>:<platform | all>"
  const [handoffs, setHandoffs] = useState({}); // platform id -> { link }
  const [picks, setPicks] = useState({}); // platform id -> account id chosen by the recruiter
  const picksRef = useRef(picks);
  picksRef.current = picks;
  const [poster, setPoster] = useState({ installed: false }); // the Raasta-AI Poster browser extension
  const claimRef = useRef(null); // records the posts the extension reports; assigned below, called from effects
  const failedClaims = useRef(new Set());

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams(picksRef.current).toString();
      const data = await api(`/api/hiring/jobs/${job.id}/platforms${query ? `?${query}` : ""}`);
      setPlatforms(data.platforms);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const p of data.platforms) if (next[p.id] === undefined) next[p.id] = p.post.text;
        return next;
      });
      setLoadError("");
    } catch (error) {
      setLoadError(error.message);
    }
  }, [job.id]);

  useEffect(() => {
    load();
  }, [load]);

  // Find the extension, and pick up posts the person confirmed on the platform's own page (also when they come back to this tab)
  useEffect(() => {
    let alive = true;
    detectPoster().then((found) => {
      if (!alive) return;
      setPoster(found);
      if (found.installed) claimRef.current?.();
    });
    const onFocus = () => claimRef.current?.();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  // Escape closes the panel, unless a question dialog (components/ui/DialogProvider.js) is on top and takes it
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== "Escape" || document.querySelector("dialog[data-app-dialog][open]")) return;
      event.preventDefault();
      if (!busyRef.current) onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const pickAccount = async (platformId, accountId) => {
    picksRef.current = { ...picksRef.current, [platformId]: accountId };
    setPicks(picksRef.current);
    await load();
  };

  const byId = (id) => platforms?.find((p) => p.id === id);
  const labelOf = (id) => byId(id)?.label || id;

  claimRef.current = async () => {
    const items = (await pollConfirmations()).filter((item) => item.jobId === job.id);
    const recorded = [];
    for (const item of items) {
      try {
        await api(`/api/hiring/jobs/${job.id}/publish/confirm`, json("POST", { platform: item.platform, postUrl: item.postUrl || "" }));
        recorded.push(item);
      } catch (error) {
        // Tell the person once per post; it is offered again next time, so nothing is lost
        if (!failedClaims.current.has(item.id)) toast.error(`Could not record the ${labelOf(item.platform)} post: ${error.message}`);
        failedClaims.current.add(item.id);
      }
    }
    if (!recorded.length) return;
    await ackConfirmations(recorded.map((item) => item.id));
    toast.success(`Marked as posted on ${recorded.map((item) => labelOf(item.platform)).join(" and ")}`);
    setHandoffs((prev) => {
      const next = { ...prev };
      for (const item of recorded) delete next[item.platform];
      return next;
    });
    await load();
    onChanged?.();
  };

  const run = async (name, scope, work) => {
    setBusy(`${name}:${scope}`);
    try {
      await work();
    } catch (error) {
      toast.error(error.message || "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  const saveDraft = async (p) => {
    await api(`/api/hiring/jobs/${job.id}`, json("PATCH", { [p.field]: drafts[p.id] }));
  };

  const save = (p) => run("save", p.id, async () => {
    await saveDraft(p);
    toast.success(`${p.label} post saved`);
    await load();
    onChanged?.();
  });

  const generate = async (target) => {
    const list = target === "all" ? platforms : [byId(target)];
    const edited = list.filter((p) => drafts[p.id] !== p.post.text);
    if (edited.length) {
      const ok = await confirm({
        title: "Replace your edits?",
        message: `The AI writes a fresh post, so your unsaved edits to ${edited.map((p) => p.label).join(" and ")} are lost.`,
        confirmText: "Replace",
        tone: "warning",
      });
      if (!ok) return;
    }
    await run("generate", target, async () => {
      const data = await api(`/api/hiring/jobs/${job.id}/generate-post`, json("POST", { platform: target, tone: "professional" }));
      setDrafts((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(data.posts).map(([id, post]) => [id, post.text])) }));
      for (const [id, post] of Object.entries(data.posts)) {
        post.warnings.forEach((warning) => toast(`${labelOf(id)}: ${warning}`, { icon: "i" }));
      }
      for (const [id, message] of Object.entries(data.errors || {})) toast.error(`${labelOf(id)}: ${message}`);
      toast.success(target === "all" ? "Posts written for each platform" : `${labelOf(target)} post written`);
      await load();
      onChanged?.();
    });
  };

  // Results of a publish request: thank the person for what worked, explain what did not
  const report = async (results) => {
    const done = results.filter((r) => r.ok);
    const problems = results.filter((r) => !r.ok);
    if (done.length) toast.success(`Posted to ${done.map((r) => labelOf(r.platform)).join(" and ")}`);
    if (problems.length) {
      const signIn = problems.some((r) => r.status === "needs_login");
      await alert({
        title: signIn ? "A platform needs you to sign in again" : "Some posts did not go out",
        message: signIn
          ? "Nothing was posted on that platform. Open it yourself to confirm the sign-in or security check, then reconnect the account under Platforms. You can also use Copy and open to post by hand."
          : "These were not posted. You can fix the reason below, or use Copy and open to post by hand.",
        items: problems.map((r) => `${labelOf(r.platform)}: ${r.error}`),
        tone: "warning",
      });
    }
    await load();
    onChanged?.();
  };

  const publishOne = async (p) => {
    const who = p.connection.accountName ? ` (${p.connection.accountName})` : "";
    const ok = await confirm({
      title: `Post to ${p.label}?`,
      message: `This publishes to the connected ${p.label} account${who} and is public straight away. It can take up to a minute.`,
      confirmText: `Post to ${p.label}`,
      tone: "warning",
    });
    if (!ok) return;
    let results = null;
    await run("publish", p.id, async () => {
      if (drafts[p.id] !== p.post.text) await saveDraft(p);
      const data = await api(`/api/hiring/jobs/${job.id}/publish`, json("POST", { platforms: [p.id], mode: "auto", accountIds: picksRef.current }));
      results = data.results;
    });
    if (results) await report(results);
  };

  const connected = (platforms || []).filter((p) => p.autoPost.available && p.connection.status === "connected");

  const publishAll = async () => {
    if (!connected.length) {
      toast.error("No platform is connected. Connect one under Platforms, or use Copy and open.");
      return;
    }
    const ok = await confirm({
      title: "Post to every connected platform?",
      message: "Each platform gets its own post, published one after another. Posts are public straight away and this can take a few minutes.",
      items: connected.map((p) => `${p.label} (${p.connection.accountName})`),
      confirmText: "Post to all",
      tone: "warning",
    });
    if (!ok) return;
    let results = null;
    await run("publish", "all", async () => {
      for (const p of connected) {
        const text = (drafts[p.id] || "").trim();
        if (!text) {
          const data = await api(`/api/hiring/jobs/${job.id}/generate-post`, json("POST", { platform: p.id, tone: "professional" }));
          setDrafts((prev) => ({ ...prev, [p.id]: data.posts[p.id].text }));
        } else if (drafts[p.id] !== p.post.text) {
          await saveDraft(p);
        }
      }
      const data = await api(`/api/hiring/jobs/${job.id}/publish`, json("POST", { platforms: connected.map((p) => p.id), mode: "auto", accountIds: picksRef.current }));
      results = data.results;
    });
    if (results) await report(results);
  };

  // The recruiter posts it themselves: copy the text, open the composer of the platform, then ask whether they posted it
  const handoff = async (p) => {
    // Open the tab now: a window opened after waiting for the server is often blocked as a pop-up
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    await run("handoff", p.id, async () => {
      try {
        if (drafts[p.id] !== p.post.text) await saveDraft(p);
        const data = await api(`/api/hiring/jobs/${job.id}/publish`, json("POST", { platforms: [p.id], mode: "handoff" }));
        const result = data.results[0];
        if (!result?.ok) throw new Error(result?.error || "Could not prepare the post");
        // With the extension installed, every field goes to the panel it shows beside the platform's own form
        let sent = false;
        if (result.kit && poster.installed) {
          try {
            await sendKit(result.kit);
            sent = true;
          } catch (error) {
            toast.error(error.message || "The Raasta-AI Poster extension did not take the fields");
          }
        }
        let copied = false;
        try {
          await navigator.clipboard.writeText(result.text);
          copied = true;
        } catch {
          copied = false;
        }
        if (tab) tab.location.href = result.handoffUrl;
        else window.open(result.handoffUrl, "_blank", "noopener,noreferrer");
        setHandoffs((prev) => ({ ...prev, [p.id]: { link: "" } }));
        toast.success(sent
          ? `Fields sent to Raasta-AI Poster. Open ${p.label}'s post form: its panel lists every field. You press Post.`
          : copied ? `Post copied. Paste it into ${p.label} and press Post.` : `Opened ${p.label}. Copy the text from the box and paste it there.`);
        await load();
      } catch (error) {
        tab?.close();
        throw error;
      }
    });
  };

  const confirmHandoff = (p) => run("confirm", p.id, async () => {
    await api(`/api/hiring/jobs/${job.id}/publish/confirm`, json("POST", { platform: p.id, postUrl: handoffs[p.id]?.link || "" }));
    setHandoffs((prev) => {
      const next = { ...prev };
      delete next[p.id];
      return next;
    });
    toast.success(`Marked as posted on ${p.label}`);
    await load();
    onChanged?.();
  });

  const limits = (platforms || []).filter((p) => p.autoPost.available).map((p) => `${p.label} ${p.guard.dailyCap} a day`).join(", ");

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby="publish-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy && !document.querySelector("dialog[data-app-dialog][open]")) onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current && !busy) onClose();
      }}
    >
      <div className="modal-box w-11/12 max-w-3xl p-0">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-base-300">
          <div className="min-w-0">
            <h2 id="publish-title" className="text-lg font-semibold truncate">Publish &ldquo;{job.title}&rdquo;</h2>
            <p className="text-sm text-base-content/60">Each platform gets its own post. Post through a connected account, or copy it and post it yourself.</p>
          </div>
          <button type="button" className="btn !normal-case btn-ghost btn-sm btn-circle" onClick={onClose} disabled={Boolean(busy)} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {!platforms && !loadError && <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary" size={24} /></div>}
          {loadError && (
            <div className="alert alert-error text-sm">
              <span>{loadError}</span>
              <button type="button" className="btn !normal-case btn-sm" onClick={load}>Try again</button>
            </div>
          )}
          {platforms && (
            <>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn !normal-case btn-primary btn-sm gap-1" onClick={publishAll} disabled={Boolean(busy) || connected.length === 0}>
                  {busy === "publish:all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Post to all connected ({connected.length})
                </button>
                <button type="button" className="btn !normal-case btn-ghost btn-sm gap-1" onClick={() => generate("all")} disabled={Boolean(busy)}>
                  {busy === "generate:all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Write posts for every platform
                </button>
              </div>

              {platforms.map((p) => (
                <PlatformCard
                  key={p.id}
                  job={job}
                  p={p}
                  text={drafts[p.id] ?? p.post.text}
                  busy={busy}
                  handoff={handoffs[p.id]}
                  poster={poster}
                  onText={(value) => setDrafts((prev) => ({ ...prev, [p.id]: value }))}
                  onSave={() => save(p)}
                  onGenerate={() => generate(p.id)}
                  onPublish={() => publishOne(p)}
                  onHandoff={() => handoff(p)}
                  onHandoffLink={(link) => setHandoffs((prev) => ({ ...prev, [p.id]: { link } }))}
                  onConfirmHandoff={() => confirmHandoff(p)}
                  onAccount={(accountId) => pickAccount(p.id, accountId)}
                  onSaveFirst={async () => { if (drafts[p.id] !== p.post.text) await saveDraft(p); }}
                  onEngineFinished={async () => { await load(); onChanged?.(); }}
                />
              ))}

              <p className="text-xs text-base-content/50">
                To keep your accounts in good standing, automatic posting is limited per account ({limits}) and stops at the first sign-in or security check. Copy and open is never limited.
              </p>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
