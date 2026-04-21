"use client";

import { useState } from "react";
import {
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Users,
  X,
  Shield,
  TestTube2,
  Settings,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useRozeeAccounts } from "../hooks";

/**
 * Rozee.pk accounts panel — mirrors the LinkedIn accounts UI but talks to
 * the /api/rozee/* tree via useRozeeAccounts.
 */
export default function RozeeAccountsPanel() {
  const {
    accounts,
    loading,
    connectAccount,
    toggleAccountStatus,
    deleteAccount,
    testAccountSession,
    updateDailyLimit,
    isConnecting,
    isTesting,
    isUpdatingLimit,
  } = useRozeeAccounts();

  const [showModal, setShowModal] = useState(false);
  const [credentials, setCredentials] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [toast, setToast] = useState({ show: false, message: "", type: "success" });
  const [debugScreenshots, setDebugScreenshots] = useState([]);
  const [showDebugModal, setShowDebugModal] = useState(false);
  const [debugIdx, setDebugIdx] = useState(0);

  const [showLimitModal, setShowLimitModal] = useState(false);
  const [accountForLimit, setAccountForLimit] = useState(null);
  const [tempLimit, setTempLimit] = useState(20);

  const showToast = (message, type = "success", duration = 4000) => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: "", type: "success" }), duration);
  };

  const handleConnect = async () => {
    if (isConnecting) return;
    if (!credentials.email || !credentials.password) {
      showToast("Please enter both email and password", "error");
      return;
    }
    try {
      const result = await connectAccount(credentials.email, credentials.password);
      setShowModal(false);
      setCredentials({ email: "", password: "" });
      showToast("Rozee account connected successfully!", "success");
      if (result.debugScreenshots?.length) {
        setDebugScreenshots(result.debugScreenshots);
        setDebugIdx(0);
        setShowDebugModal(true);
      }
    } catch (error) {
      let msg = error.message || "Failed to connect Rozee account";
      if (error.errorCode === "INVALID_CREDENTIALS") msg = "Invalid email or password.";
      else if (error.errorCode === "2FA_NOT_SUPPORTED") msg = "OTP/2FA verification is not supported on this account.";
      showToast(msg, "error");
      if (error.debugScreenshots?.length) {
        setDebugScreenshots(error.debugScreenshots);
        setDebugIdx(0);
        setShowDebugModal(true);
      }
    }
  };

  const handleToggle = async (accountId, isActive) => {
    try {
      await toggleAccountStatus(accountId, isActive);
    } catch (error) {
      showToast(error.message || "Failed to update Rozee account status", "error");
    }
  };

  const handleDelete = async (accountId) => {
    if (!confirm("Disconnect this Rozee account?")) return;
    try {
      await deleteAccount(accountId);
      showToast("Rozee account disconnected", "success");
    } catch (error) {
      showToast(error.message || "Failed to delete Rozee account", "error");
    }
  };

  const handleTest = async (accountId) => {
    try {
      const result = await testAccountSession(accountId);
      if (result.isValid) showToast("Rozee session is valid!", "success");
      else showToast(`Session invalid: ${result.reason}`, "error");
    } catch (error) {
      showToast(error.message || "Failed to test Rozee session", "error");
    }
  };

  const openLimitModal = (account) => {
    setAccountForLimit(account);
    setTempLimit(Math.min(account.dailyLimit || 20, 30));
    setShowLimitModal(true);
  };

  const saveLimit = async () => {
    if (!accountForLimit) return;
    try {
      await updateDailyLimit(accountForLimit.dbId || accountForLimit.id, tempLimit);
      showToast(`Daily apply limit updated to ${tempLimit}`, "success");
      setShowLimitModal(false);
      setAccountForLimit(null);
    } catch (error) {
      showToast(error.message || "Failed to update daily limit", "error");
    }
  };

  return (
    <div>
      <div className="mb-6">
        <button className="btn btn-primary gap-2" onClick={() => setShowModal(true)}>
          <Plus className="h-4 w-4" />
          Add Rozee Account
        </button>
      </div>

      <div className="card bg-base-100 border border-base-300 overflow-hidden shadow-sm">
        <div className="bg-base-200 px-6 py-4 border-b border-base-300">
          <div className="grid grid-cols-12 gap-6 items-center text-sm font-medium text-base-content/70 uppercase tracking-wider">
            <div className="col-span-4">Account Info</div>
            <div className="col-span-2">Active</div>
            <div className="col-span-3">Daily Limits</div>
            <div className="col-span-3">Actions</div>
          </div>
        </div>

        <div className="divide-y divide-base-300">
          {loading ? (
            <div className="py-12 text-center">
              <div className="loading loading-spinner loading-lg text-primary"></div>
              <p className="mt-4 text-base-content/60">Loading Rozee accounts...</p>
            </div>
          ) : accounts.length === 0 ? (
            <div className="py-12 text-center">
              <div className="w-16 h-16 bg-base-200 rounded-full flex items-center justify-center mx-auto mb-4">
                <Users className="h-8 w-8 text-base-content/40" />
              </div>
              <h3 className="text-lg font-medium text-base-content mb-2">No Rozee accounts yet</h3>
              <p className="text-base-content/60 mb-4">Connect a Rozee.pk account to enable scraping & messaging.</p>
              <button className="btn btn-primary gap-2" onClick={() => setShowModal(true)}>
                <Plus className="h-4 w-4" />
                Add Rozee Account
              </button>
            </div>
          ) : (
            accounts.map((account) => (
              <div key={account.id} className="px-6 py-5 hover:bg-base-50 transition-colors">
                <div className="grid grid-cols-12 gap-6 items-center">
                  <div className="col-span-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-full flex items-center justify-center">
                        <span className="text-white font-medium text-sm">
                          {(account.name || account.email).split(" ").map((n) => n[0]).slice(0, 2).join("")}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-base-content truncate">{account.name || account.email}</div>
                        <div className="text-xs text-base-content/40 mt-1">Added {account.addedDate}</div>
                      </div>
                    </div>
                  </div>

                  <div className="col-span-2">
                    <input
                      type="checkbox"
                      className="toggle toggle-primary toggle-lg"
                      checked={account.isActive || false}
                      onChange={(e) => handleToggle(account.id, e.target.checked)}
                    />
                  </div>

                  <div className="col-span-3">
                    <div className="space-y-1 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-base-content/60">Today&apos;s applies</span>
                        <span className="font-medium">{account.dailyInvitesSent}/{account.dailyLimit}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-base-content/60">Today&apos;s messages</span>
                        <span className="font-medium">{account.dailyMessagesSent}/{account.dailyMessageLimit}</span>
                      </div>
                    </div>
                    <button
                      className="btn btn-outline btn-xs mt-2 gap-1"
                      onClick={() => openLimitModal(account)}
                    >
                      <Settings className="h-3 w-3" />
                      Configure Limits
                    </button>
                  </div>

                  <div className="col-span-3">
                    <div className="flex items-center gap-1">
                      {account.isActive && (
                        <button
                          className="btn btn-ghost btn-sm btn-circle"
                          title="Test session validity"
                          onClick={() => handleTest(account.id)}
                          disabled={isTesting}
                        >
                          {isTesting ? (
                            <div className="loading loading-spinner loading-xs"></div>
                          ) : (
                            <TestTube2 className="h-4 w-4" />
                          )}
                        </button>
                      )}
                      <button
                        className="btn btn-ghost btn-sm btn-circle text-error"
                        title="Disconnect"
                        onClick={() => handleDelete(account.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-base-100 rounded-2xl shadow-2xl w-full max-w-md mx-auto">
            <div className="flex items-center justify-between p-6 border-b border-base-300">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-emerald-600 rounded flex items-center justify-center">
                  <span className="text-white text-xs font-bold">RZ</span>
                </div>
                <h3 className="text-lg font-semibold text-base-content">Connect Rozee Account</h3>
              </div>
              <button className="btn btn-ghost btn-sm btn-circle" onClick={() => setShowModal(false)} disabled={isConnecting}>
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6">
              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-base-content mb-2">Rozee Email</label>
                  <input
                    type="email"
                    value={credentials.email}
                    onChange={(e) => setCredentials((p) => ({ ...p, email: e.target.value }))}
                    placeholder="Enter your Rozee.pk email"
                    className="input input-bordered w-full"
                    disabled={isConnecting}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-base-content mb-2">Rozee Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={credentials.password}
                      onChange={(e) => setCredentials((p) => ({ ...p, password: e.target.value }))}
                      placeholder="Enter your Rozee.pk password"
                      className="input input-bordered w-full pr-10"
                      disabled={isConnecting}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-base-content/40 hover:text-base-content/60 transition-colors"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-success/10 border border-success/20 rounded-lg p-4 mb-6">
                <div className="flex items-start gap-3">
                  <Shield className="h-5 w-5 text-success flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-medium text-success mb-1">Secure Browser Login</h4>
                    <p className="text-xs text-success/80">
                      Credentials are used only for the initial Playwright login; only cookies + storage are persisted for session reuse.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button className="btn btn-ghost btn-sm flex-1" onClick={() => setShowModal(false)} disabled={isConnecting}>
                  Cancel
                </button>
                <button className="btn btn-primary btn-sm flex-1 gap-2" onClick={handleConnect} disabled={isConnecting}>
                  {isConnecting ? (
                    <>
                      <span className="loading loading-spinner loading-xs"></span>
                      <span className="text-xs">Connecting...</span>
                    </>
                  ) : (
                    <span className="text-xs">Connect Rozee</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showLimitModal && accountForLimit && (
        <div className="modal modal-open">
          <div className="modal-box max-w-md bg-base-100 border border-base-300">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="font-bold text-lg">Daily Apply Limit</h3>
                <p className="text-sm text-base-content/60 mt-1">{accountForLimit.email}</p>
              </div>
              <button className="btn btn-sm btn-circle btn-ghost" onClick={() => setShowLimitModal(false)} disabled={isUpdatingLimit}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <input
              type="number"
              min="1"
              max="30"
              value={tempLimit}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v)) setTempLimit(Math.max(1, Math.min(30, v)));
              }}
              className="input input-bordered w-full text-center text-2xl font-bold mb-4"
              disabled={isUpdatingLimit}
            />
            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setShowLimitModal(false)} disabled={isUpdatingLimit}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveLimit} disabled={isUpdatingLimit}>
                {isUpdatingLimit ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDebugModal && debugScreenshots.length > 0 && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-base-100 rounded-xl shadow-2xl w-full max-w-3xl flex flex-col gap-4 p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-base-content">
                Rozee Debug Screenshots ({debugIdx + 1} / {debugScreenshots.length})
              </h3>
              <button className="btn btn-sm btn-circle btn-ghost" onClick={() => setShowDebugModal(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="text-sm text-base-content/70 space-y-0.5">
              <p className="font-medium">{debugScreenshots[debugIdx]?.label}</p>
              <p className="text-xs font-mono truncate">{debugScreenshots[debugIdx]?.url}</p>
            </div>
            <div className="rounded-lg overflow-hidden border border-base-300 bg-base-200 min-h-[300px] flex items-center justify-center">
              {debugScreenshots[debugIdx]?.dataUri ? (
                <img src={debugScreenshots[debugIdx].dataUri} alt={debugScreenshots[debugIdx].label} className="w-full object-contain" />
              ) : (
                <p className="text-sm text-base-content/50">No screenshot available — {debugScreenshots[debugIdx]?.error}</p>
              )}
            </div>
            <div className="flex items-center justify-between">
              <button className="btn btn-sm btn-outline gap-1" disabled={debugIdx === 0} onClick={() => setDebugIdx((i) => i - 1)}>
                <ChevronLeft className="h-4 w-4" /> Prev
              </button>
              <button
                className="btn btn-sm btn-outline gap-1"
                disabled={debugIdx === debugScreenshots.length - 1}
                onClick={() => setDebugIdx((i) => i + 1)}
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {toast.show && (
        <div className="fixed top-4 right-4 z-50">
          <div className={`alert ${toast.type === "error" ? "alert-error" : "alert-success"} shadow-lg`}>
            <div>
              <span>{toast.message}</span>
            </div>
            <button className="btn btn-sm btn-circle btn-ghost" onClick={() => setToast({ show: false, message: "", type: "success" })}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
