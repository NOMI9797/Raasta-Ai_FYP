"use client";

import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useDialog } from "@/components/ui/DialogProvider";
import { Bug, ChevronLeft, ChevronRight, ExternalLink, Loader2, Plus, Shield, TestTube2, Trash2, Users, X } from "lucide-react";
import { useIndeedAccounts } from "../hooks";

function minutesLeft(waitsUntil) {
  return Math.max(1, Math.ceil((new Date(waitsUntil).getTime() - Date.now()) / 60000));
}

const OUTCOME_BADGE = { reached_post_page: "badge-success", error: "badge-error" };

// What a diagnostic saw: the outcome, a screenshot viewer for the pages it visited, and any errors on those pages
function DiagnosisResult({ diagnosis, index, onIndex, onClose }) {
  const shots = diagnosis.steps.filter((step) => step.dataUri);
  const at = Math.min(index, Math.max(0, shots.length - 1));
  const shot = shots[at];

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-base-100 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto flex flex-col gap-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold">Indeed diagnostic</h3>
            <p className="text-sm mt-1">
              <span className={`badge badge-sm mr-2 ${OUTCOME_BADGE[diagnosis.outcome] || "badge-warning"}`}>{diagnosis.outcome.replace(/_/g, " ")}</span>
              {diagnosis.message}
            </p>
            <p className="text-xs text-base-content/50 mt-1">Saved on the server in <code>{diagnosis.location}</code></p>
          </div>
          <button className="btn btn-sm btn-circle btn-ghost" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>

        {shot ? (
          <>
            <div className="text-sm space-y-0.5">
              <p className="font-medium">{shot.name.replace(/-/g, " ")} ({at + 1} / {shots.length})</p>
              <p className="text-xs font-mono truncate">{shot.url}</p>
              {shot.title && <p className="text-xs text-base-content/60 truncate">{shot.title}</p>}
              {shot.summary && <p className="text-xs text-base-content/60">{shot.summary.buttons} buttons, {shot.summary.links} links, {shot.summary.fields} fields on the page</p>}
            </div>
            <div className="rounded-lg overflow-hidden border border-base-300 bg-base-200 flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shot.dataUri} alt={shot.name} className="w-full object-contain" />
            </div>
            <div className="flex items-center justify-between">
              <button className="btn btn-sm btn-outline gap-1" disabled={at === 0} onClick={() => onIndex(at - 1)}><ChevronLeft className="h-4 w-4" /> Prev</button>
              <button className="btn btn-sm btn-outline gap-1" disabled={at >= shots.length - 1} onClick={() => onIndex(at + 1)}>Next <ChevronRight className="h-4 w-4" /></button>
            </div>
          </>
        ) : (
          <p className="text-sm text-base-content/60">No screenshot was taken.</p>
        )}

        <div className="text-xs space-y-1">
          <p className="font-semibold text-sm">Steps</p>
          <ul className="space-y-0.5">
            {diagnosis.steps.map((step) => (
              <li key={step.index}>
                {step.index}. <span className="font-medium">{step.name}</span>
                {step.note ? ` · ${step.note}` : ""}
                {step.error ? <span className="text-error"> · {step.error}</span> : null}
              </li>
            ))}
          </ul>
          {(diagnosis.failedRequests.length > 0 || diagnosis.pageErrors.length > 0) && (
            <div className="pt-2">
              <p className="font-semibold text-sm">Errors seen on the page</p>
              <ul className="space-y-0.5 font-mono">
                {diagnosis.failedRequests.slice(0, 8).map((r, i) => <li key={`r${i}`}>{r.status || "failed"} {r.method} {r.url}</li>)}
                {diagnosis.pageErrors.slice(0, 5).map((e, i) => <li key={`e${i}`}>{e}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Indeed accounts panel. Indeed signs people in with an emailed code, Google or Apple, so there is no password
 * form here: "Connect" opens a real browser window on Indeed (on the machine that runs Raasta-AI), the person
 * signs in there, and only the resulting session is stored.
 */
export default function IndeedAccountsPanel() {
  const { confirm } = useDialog();
  const {
    accounts,
    loading,
    connectAttempt,
    startConnect,
    cancelConnect,
    toggleAccountStatus,
    deleteAccount,
    testAccountSession,
    runDiagnostic,
    debugInfo,
    isStarting,
    isCancelling,
    isTesting,
    isDiagnosing,
  } = useIndeedAccounts();

  const [showModal, setShowModal] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [diagnoseTarget, setDiagnoseTarget] = useState(null); // the account the options dialog is for
  const [showWindow, setShowWindow] = useState(false);
  const [diagnosis, setDiagnosis] = useState(null); // result of the last diagnostic
  const [shotIndex, setShotIndex] = useState(0);

  const waiting = connectAttempt.status === "waiting";

  // Tell the person how the sign-in window ended, once, when it ends
  const previous = useRef(connectAttempt.status);
  useEffect(() => {
    const before = previous.current;
    previous.current = connectAttempt.status;
    if (before !== "waiting" || connectAttempt.status === "waiting") return;
    if (connectAttempt.status === "connected") {
      toast.success("Indeed account connected");
      setShowModal(false);
      setEmail("");
    } else {
      toast.error(connectAttempt.message || "Indeed sign-in did not finish");
    }
  }, [connectAttempt.status, connectAttempt.message]);

  const openWindow = async () => {
    setError("");
    try {
      await startConnect(email);
    } catch (err) {
      setError(err.message || "Could not open the Indeed sign-in window");
    }
  };

  const handleToggle = async (accountId, isActive) => {
    try {
      await toggleAccountStatus(accountId, isActive);
    } catch (err) {
      toast.error(err.message || "Failed to update Indeed account status");
    }
  };

  const handleDelete = async (accountId) => {
    const ok = await confirm({
      title: "Disconnect this Indeed account?",
      message: "The saved session is removed from Raasta-AI. You can connect the account again later.",
      confirmText: "Disconnect",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deleteAccount(accountId);
      toast.success("Indeed account disconnected");
    } catch (err) {
      toast.error(err.message || "Failed to disconnect Indeed account");
    }
  };

  const handleTest = async (accountId) => {
    try {
      const result = await testAccountSession(accountId);
      if (result.isValid) toast.success("Indeed session is valid");
      else toast.error(result.challenge ? "Indeed is asking for a verification check. Open Indeed yourself to confirm it, then reconnect." : `Session invalid: ${result.reason}`);
    } catch (err) {
      toast.error(err.message || "Failed to test Indeed session");
    }
  };

  const handleDiagnose = async () => {
    const account = diagnoseTarget;
    try {
      const result = await runDiagnostic(account.id, showWindow);
      setDiagnoseTarget(null);
      setDiagnosis(result);
      setShotIndex(0);
    } catch (err) {
      setDiagnoseTarget(null);
      toast.error(err.message || "The diagnostic could not run");
    }
  };

  const closeModal = () => {
    if (!waiting) setShowModal(false);
  };

  return (
    <div>
      <div className="mb-6 space-y-2">
        <button className="btn btn-primary gap-2" onClick={() => setShowModal(true)}>
          <Plus className="h-4 w-4" />
          Add Indeed Account
        </button>
        <p className="text-xs text-base-content/60">
          Recruiter posts to Indeed with the <strong>posting engine</strong> (a window you watch, with its own sign-in) or with{" "}
          <strong>Copy and open</strong>; neither needs an account connected here. A connected account is used by Diagnose below.
          Searching Indeed for leads (Sales) needs no account either.
        </p>
      </div>

      <div className="card bg-base-100 border border-base-300 overflow-hidden shadow-sm">
        <div className="bg-base-200 px-6 py-4 border-b border-base-300">
          <div className="grid grid-cols-12 gap-6 items-center text-sm font-medium text-base-content/70 uppercase tracking-wider">
            <div className="col-span-6">Account Info</div>
            <div className="col-span-3">Active</div>
            <div className="col-span-3">Actions</div>
          </div>
        </div>

        <div className="divide-y divide-base-300">
          {loading ? (
            <div className="py-12 text-center">
              <div className="loading loading-spinner loading-lg text-primary"></div>
              <p className="mt-4 text-base-content/60">Loading Indeed accounts...</p>
            </div>
          ) : accounts.length === 0 ? (
            <div className="py-12 text-center">
              <div className="w-16 h-16 bg-base-200 rounded-full flex items-center justify-center mx-auto mb-4">
                <Users className="h-8 w-8 text-base-content/40" />
              </div>
              <h3 className="text-lg font-medium text-base-content mb-2">No Indeed accounts yet</h3>
              <p className="text-base-content/60 mb-4">Connect an Indeed employer account to post jobs from Raasta-AI.</p>
              <button className="btn btn-primary gap-2" onClick={() => setShowModal(true)}>
                <Plus className="h-4 w-4" />
                Add Indeed Account
              </button>
            </div>
          ) : (
            accounts.map((account) => (
              <div key={account.id} className="px-6 py-5 hover:bg-base-50 transition-colors">
                <div className="grid grid-cols-12 gap-6 items-center">
                  <div className="col-span-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-teal-600 to-teal-800 rounded-full flex items-center justify-center">
                        <span className="text-white font-medium text-sm">
                          {(account.name || account.email).slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-base-content truncate">
                          {account.name || account.email}
                          {!account.own && <span className="badge badge-ghost badge-sm ml-2">Team</span>}
                        </div>
                        <div className="text-xs text-base-content/40 mt-1">Added {account.addedDate}</div>
                      </div>
                    </div>
                  </div>

                  <div className="col-span-3">
                    <input
                      type="checkbox"
                      className="toggle toggle-primary toggle-lg"
                      checked={account.isActive || false}
                      disabled={!account.own}
                      onChange={(e) => handleToggle(account.id, e.target.checked)}
                      aria-label={`Switch ${account.name || account.email} ${account.isActive ? "off" : "on"}`}
                    />
                  </div>

                  <div className="col-span-3">
                    <div className="flex items-center gap-1">
                      {account.own && account.isActive && (
                        <button
                          className="btn btn-ghost btn-sm btn-circle"
                          title="Test session validity"
                          onClick={() => handleTest(account.id)}
                          disabled={isTesting}
                        >
                          {isTesting ? <div className="loading loading-spinner loading-xs"></div> : <TestTube2 className="h-4 w-4" />}
                        </button>
                      )}
                      {account.own && (
                        <button
                          className="btn btn-ghost btn-sm btn-circle"
                          title="Diagnose: see what the automation sees"
                          onClick={() => setDiagnoseTarget(account)}
                        >
                          <Bug className="h-4 w-4" />
                        </button>
                      )}
                      {account.own && (
                        <button
                          className="btn btn-ghost btn-sm btn-circle text-error"
                          title="Disconnect"
                          onClick={() => handleDelete(account.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="mt-6 space-y-2">
        <h3 className="text-sm font-semibold">Debugging</h3>
        <p className="text-xs text-base-content/60">
          Use the bug button on an account to see what the automation sees on Indeed. Posting attempts are recorded the same way when{" "}
          <code>INDEED_DEBUG=true</code> is set (publish debugging is <strong>{debugInfo.publishDebugging ? "on" : "off"}</strong>).
          Recordings are saved in <code>debug-indeed/</code> on the server.
        </p>
        {debugInfo.runs.length > 0 && (
          <ul className="text-xs divide-y divide-base-300 border border-base-300 rounded-lg">
            {debugInfo.runs.map((run) => (
              <li key={run.runId} className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="badge badge-sm badge-ghost">{run.label || "run"}</span>
                <span className="font-medium">{run.outcome || "no result"}</span>
                <span className="text-base-content/50">{run.steps} step{run.steps === 1 ? "" : "s"}</span>
                <code className="text-base-content/50 truncate">{run.location}</code>
              </li>
            ))}
          </ul>
        )}
      </div>

      {diagnoseTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-base-100 rounded-2xl shadow-2xl w-full max-w-md mx-auto">
            <div className="flex items-center justify-between p-6 border-b border-base-300">
              <h3 className="text-lg font-semibold">Diagnose Indeed</h3>
              <button className="btn btn-ghost btn-sm btn-circle" onClick={() => setDiagnoseTarget(null)} disabled={isDiagnosing} aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-6 space-y-4 text-sm">
              <p>
                Opens the employer area as <strong>{diagnoseTarget.name || diagnoseTarget.email}</strong> with the saved session, follows
                &ldquo;Post a job&rdquo; and takes screenshots and notes of the page. It <strong>never fills in or submits</strong> anything.
                It looks like one person opening the dashboard, and it stops at once at a sign-in page or a verification check.
              </p>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" className="checkbox checkbox-sm mt-0.5" checked={showWindow} onChange={(e) => setShowWindow(e.target.checked)} disabled={isDiagnosing} />
                <span>Show the browser window while it runs <span className="text-base-content/50">(opens on the computer that runs Raasta-AI)</span></span>
              </label>
              <p className="text-xs text-base-content/60">
                If Indeed shows a verification check, a hidden run stops there. With the window shown, the diagnostic waits (up to 3 minutes) for
                <strong> you</strong> to clear the check yourself and then carries on. It never clicks the check for you.
              </p>
              <div className="flex gap-3 pt-2">
                <button className="btn btn-ghost btn-sm flex-1" onClick={() => setDiagnoseTarget(null)} disabled={isDiagnosing}>Cancel</button>
                <button className="btn btn-primary btn-sm flex-1 gap-2" onClick={handleDiagnose} disabled={isDiagnosing}>
                  {isDiagnosing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bug className="h-4 w-4" />}
                  {isDiagnosing ? "Visiting Indeed..." : "Run diagnostic"}
                </button>
              </div>
              {isDiagnosing && <p className="text-xs text-base-content/50">This takes up to a minute.</p>}
            </div>
          </div>
        </div>
      )}

      {diagnosis && <DiagnosisResult diagnosis={diagnosis} index={shotIndex} onIndex={setShotIndex} onClose={() => setDiagnosis(null)} />}

      {(showModal || waiting) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-base-100 rounded-2xl shadow-2xl w-full max-w-md mx-auto">
            <div className="flex items-center justify-between p-6 border-b border-base-300">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-teal-700 rounded flex items-center justify-center">
                  <span className="text-white text-xs font-bold">Id</span>
                </div>
                <h3 className="text-lg font-semibold text-base-content">Connect Indeed Account</h3>
              </div>
              <button className="btn btn-ghost btn-sm btn-circle" onClick={closeModal} disabled={waiting} aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {waiting ? (
                <>
                  <div className="flex items-start gap-3">
                    <Loader2 className="h-5 w-5 animate-spin text-primary mt-0.5 shrink-0" />
                    <div className="text-sm space-y-1">
                      <p className="font-medium">Waiting for you to sign in</p>
                      <p className="text-base-content/70">
                        A browser window opened on Indeed. Sign in there with your employer account (email code, Google or Apple).
                        This page continues by itself when you reach the employer dashboard.
                      </p>
                      <p className="text-xs text-base-content/50">
                        {connectAttempt.email} · waits up to {minutesLeft(connectAttempt.waitsUntil)} more minute{minutesLeft(connectAttempt.waitsUntil) === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                  <button className="btn btn-outline btn-sm w-full" onClick={() => cancelConnect()} disabled={isCancelling}>
                    {isCancelling ? <span className="loading loading-spinner loading-xs"></span> : "Cancel and close the window"}
                  </button>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-base-content mb-2" htmlFor="indeed-email">Indeed email</label>
                    <input
                      id="indeed-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="The email you sign in to Indeed with"
                      className="input input-bordered w-full"
                      disabled={isStarting}
                    />
                    <p className="text-xs text-base-content/50 mt-1">Only used to name the account here. You type your sign-in details into Indeed itself.</p>
                  </div>

                  <div className="bg-success/10 border border-success/20 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <Shield className="h-5 w-5 text-success flex-shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-sm font-medium text-success mb-1">You sign in yourself</h4>
                        <p className="text-xs text-success/80">
                          A real browser window opens on Indeed. No password or code passes through Raasta-AI; only the signed-in session is stored.
                          The window opens on the computer that runs Raasta-AI.
                        </p>
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-base-content/60 flex items-start gap-1.5">
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    Needs an Indeed employer account (employers.indeed.com) with your company set up.
                  </p>

                  {error && <div className="alert alert-error py-2 text-sm"><span>{error}</span></div>}

                  <div className="flex gap-3 pt-2">
                    <button className="btn btn-ghost btn-sm flex-1" onClick={closeModal} disabled={isStarting}>
                      Cancel
                    </button>
                    <button className="btn btn-primary btn-sm flex-1 gap-2" onClick={openWindow} disabled={isStarting || !email.trim()}>
                      {isStarting ? <span className="loading loading-spinner loading-xs"></span> : null}
                      <span className="text-xs">Open Indeed sign-in</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
