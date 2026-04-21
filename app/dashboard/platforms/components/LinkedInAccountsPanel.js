"use client";

import { useState } from "react";
import Image from "next/image";
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
import { useLinkedInAccounts } from "@/app/dashboard/accounts/hooks";

export default function LinkedInAccountsPanel() {
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
  } = useLinkedInAccounts();

  const [showModal, setShowModal] = useState(false);
  const [credentials, setCredentials] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [toast, setToast] = useState({ show: false, message: "", type: "success" });
  const [debugScreenshots, setDebugScreenshots] = useState([]);
  const [showDebugModal, setShowDebugModal] = useState(false);
  const [debugIdx, setDebugIdx] = useState(0);

  const [showLimitModal, setShowLimitModal] = useState(false);
  const [accountForLimit, setAccountForLimit] = useState(null);
  const [tempLimit, setTempLimit] = useState(30);

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
      showToast("LinkedIn account connected!", "success");
      if (result?.debugScreenshots?.length) {
        setDebugScreenshots(result.debugScreenshots);
        setDebugIdx(0);
        setShowDebugModal(true);
      }
    } catch (error) {
      let msg = error.message || "Failed to connect LinkedIn account";
      if (error.message?.includes("INVALID_CREDENTIALS")) msg = "Invalid email or password.";
      else if (error.message?.includes("2FA_NOT_SUPPORTED")) msg = "2FA is enabled — disable it and retry.";
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
      showToast(error.message || "Failed to update account status", "error");
    }
  };

  const handleDelete = async (accountId) => {
    if (!confirm("Disconnect this LinkedIn account?")) return;
    try {
      await deleteAccount(accountId);
      showToast("Account disconnected", "success");
    } catch (error) {
      showToast(error.message || "Failed to disconnect", "error");
    }
  };

  const handleTest = async (accountId) => {
    try {
      const result = await testAccountSession(accountId);
      if (result.isValid) showToast("Session is valid!", "success");
      else showToast(`Session invalid: ${result.reason}`, "error");
    } catch (error) {
      showToast(error.message || "Failed to test session", "error");
    }
  };

  const openLimitModal = (account) => {
    setAccountForLimit(account);
    setTempLimit(Math.min(account.dailyLimit || 30, 30));
    setShowLimitModal(true);
  };

  const saveLimit = async () => {
    if (!accountForLimit) return;
    try {
      await updateDailyLimit(accountForLimit.id, tempLimit);
      showToast(`Daily limit updated to ${tempLimit}`, "success");
      setShowLimitModal(false);
      setAccountForLimit(null);
    } catch (error) {
      showToast(error.message || "Failed to update daily limit", "error");
    }
  };

  return (
    <div>
      <div className="mb-4">
        <button className="btn btn-primary btn-sm gap-2" onClick={() => setShowModal(true)}>
          <Plus className="h-4 w-4" /> Add LinkedIn Account
        </button>
      </div>

      <div className="card bg-base-100 border border-base-300 overflow-hidden">
        <div className="bg-base-200 px-6 py-3 border-b border-base-300">
          <div className="grid grid-cols-12 gap-4 items-center text-xs font-medium text-base-content/70 uppercase tracking-wider">
            <div className="col-span-4">Account</div>
            <div className="col-span-2">Active</div>
            <div className="col-span-3">Daily Invites</div>
            <div className="col-span-3 text-right">Actions</div>
          </div>
        </div>

        <div className="divide-y divide-base-300">
          {loading ? (
            <div className="py-12 text-center">
              <div className="loading loading-spinner loading-lg text-primary" />
              <p className="mt-3 text-base-content/60">Loading LinkedIn accounts…</p>
            </div>
          ) : accounts.length === 0 ? (
            <div className="py-12 text-center">
              <div className="w-14 h-14 bg-base-200 rounded-full flex items-center justify-center mx-auto mb-3">
                <Users className="h-7 w-7 text-base-content/40" />
              </div>
              <p className="text-base-content/60 mb-3">No LinkedIn accounts connected yet</p>
              <button className="btn btn-primary btn-sm gap-2" onClick={() => setShowModal(true)}>
                <Plus className="h-4 w-4" /> Connect first account
              </button>
            </div>
          ) : (
            accounts.map((account) => (
              <div key={account.id} className="px-6 py-4 hover:bg-base-50">
                <div className="grid grid-cols-12 gap-4 items-center">
                  <div className="col-span-4">
                    <div className="flex items-center gap-3">
                      {account.profileImageUrl ? (
                        <Image
                          src={account.profileImageUrl}
                          alt={account.name}
                          width={40}
                          height={40}
                          className="w-10 h-10 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center">
                          <span className="text-white font-medium text-sm">
                            {account.name?.split(" ").map((n) => n[0]).join("") ?? "?"}
                          </span>
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-medium truncate">{account.name}</div>
                        <div className="text-xs text-base-content/60 truncate">{account.email}</div>
                      </div>
                    </div>
                  </div>

                  <div className="col-span-2">
                    <input
                      type="checkbox"
                      className="toggle toggle-primary toggle-sm"
                      checked={account.isActive || false}
                      onChange={(e) => handleToggle(account.id, e.target.checked)}
                    />
                  </div>

                  <div className="col-span-3">
                    <div className="text-sm">
                      <span className="font-medium">{account.dailyInvitesSent || 0}</span>
                      <span className="text-base-content/60"> / {account.dailyLimit || 30}</span>
                    </div>
                    <button
                      className="btn btn-xs btn-ghost gap-1 mt-1"
                      onClick={() => openLimitModal(account)}
                    >
                      <Settings className="h-3 w-3" /> Configure
                    </button>
                  </div>

                  <div className="col-span-3 flex justify-end gap-1">
                    {account.isActive && (
                      <button
                        className="btn btn-ghost btn-xs btn-circle"
                        onClick={() => handleTest(account.id)}
                        disabled={isTesting}
                        title="Test session"
                      >
                        {isTesting ? (
                          <div className="loading loading-spinner loading-xs" />
                        ) : (
                          <TestTube2 className="h-4 w-4" />
                        )}
                      </button>
                    )}
                    <button
                      className="btn btn-ghost btn-xs btn-circle text-error"
                      onClick={() => handleDelete(account.id)}
                      title="Disconnect"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-base-100 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-base-300">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center">
                  <span className="text-white text-xs font-bold">in</span>
                </div>
                <h3 className="font-semibold">Connect LinkedIn Account</h3>
              </div>
              <button
                className="btn btn-sm btn-ghost btn-circle"
                onClick={() => setShowModal(false)}
                disabled={isConnecting}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <input
                  type="email"
                  value={credentials.email}
                  onChange={(e) => setCredentials((p) => ({ ...p, email: e.target.value }))}
                  className="input input-bordered w-full"
                  disabled={isConnecting}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={credentials.password}
                    onChange={(e) => setCredentials((p) => ({ ...p, password: e.target.value }))}
                    className="input input-bordered w-full pr-10"
                    disabled={isConnecting}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-base-content/50"
                    onClick={() => setShowPassword((s) => !s)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="bg-success/10 border border-success/20 rounded-lg p-3 flex items-start gap-2">
                <Shield className="h-4 w-4 text-success mt-0.5 shrink-0" />
                <p className="text-xs text-success/80">
                  We login automatically in a headless browser and only store the session cookies.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  className="btn btn-ghost flex-1"
                  onClick={() => setShowModal(false)}
                  disabled={isConnecting}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary flex-1"
                  onClick={handleConnect}
                  disabled={isConnecting}
                >
                  {isConnecting ? (
                    <span className="loading loading-spinner loading-xs" />
                  ) : (
                    "Connect"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showLimitModal && accountForLimit && (
        <div className="modal modal-open">
          <div className="modal-box max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">Configure Daily Limit</h3>
              <button
                className="btn btn-sm btn-circle btn-ghost"
                onClick={() => setShowLimitModal(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm text-base-content/70 mb-3">{accountForLimit.email}</p>
            <div className="flex items-center gap-3 mb-3">
              <button
                className="btn btn-circle btn-outline btn-sm"
                onClick={() => setTempLimit((v) => Math.max(1, v - 1))}
                disabled={isUpdatingLimit}
              >
                -
              </button>
              <input
                type="number"
                min="1"
                max="30"
                value={tempLimit}
                onChange={(e) =>
                  setTempLimit(Math.max(1, Math.min(30, parseInt(e.target.value) || 1)))
                }
                className="input input-bordered w-full text-center text-xl font-bold"
                disabled={isUpdatingLimit}
              />
              <button
                className="btn btn-circle btn-outline btn-sm"
                onClick={() => setTempLimit((v) => Math.min(30, v + 1))}
                disabled={isUpdatingLimit}
              >
                +
              </button>
            </div>
            <p className="text-xs text-base-content/60 mb-4">
              LinkedIn recommends max 30 invites per day.
            </p>
            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setShowLimitModal(false)} disabled={isUpdatingLimit}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveLimit} disabled={isUpdatingLimit}>
                {isUpdatingLimit ? <span className="loading loading-spinner loading-xs" /> : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDebugModal && debugScreenshots.length > 0 && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-base-100 rounded-xl shadow-2xl w-full max-w-3xl flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold">
                Debug Screenshots ({debugIdx + 1} / {debugScreenshots.length})
              </h3>
              <button
                className="btn btn-sm btn-circle btn-ghost"
                onClick={() => setShowDebugModal(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm text-base-content/70">{debugScreenshots[debugIdx]?.label}</p>
            <div className="rounded-lg overflow-hidden border border-base-300 bg-base-200 min-h-[300px] flex items-center justify-center">
              {debugScreenshots[debugIdx]?.dataUri ? (
                <img
                  src={debugScreenshots[debugIdx].dataUri}
                  alt={debugScreenshots[debugIdx].label}
                  className="w-full object-contain"
                />
              ) : (
                <p className="text-base-content/50">No screenshot</p>
              )}
            </div>
            <div className="flex items-center justify-between">
              <button
                className="btn btn-sm btn-outline gap-1"
                disabled={debugIdx === 0}
                onClick={() => setDebugIdx((i) => i - 1)}
              >
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
            <span>{toast.message}</span>
            <button
              className="btn btn-sm btn-circle btn-ghost"
              onClick={() => setToast({ show: false, message: "", type: "success" })}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
