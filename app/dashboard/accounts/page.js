"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import { useLinkedInAccounts } from "./hooks";
import {
  Plus,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  Settings,
  Trash2,
  Edit,
  Eye,
  EyeOff,
  Users,
  MessageSquare,
  X,
  Shield,
  TestTube2,
} from "lucide-react";

export default function AccountsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const accountsPerPage = 10;
  const [showLinkedInModal, setShowLinkedInModal] = useState(false);
  const [linkedInCredentials, setLinkedInCredentials] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [selectedAccountForLimit, setSelectedAccountForLimit] = useState(null);
  const [tempDailyLimit, setTempDailyLimit] = useState(30);
  const [debugScreenshots, setDebugScreenshots] = useState([]);
  const [showDebugModal, setShowDebugModal] = useState(false);
  const [debugScreenshotIndex, setDebugScreenshotIndex] = useState(0);

  // Use React Query hooks for LinkedIn accounts
  const {
    accounts,
    loading: isLoadingAccounts,
    connectAccount,
    toggleAccountStatus,
    testAccountSession,
    updateDailyLimit,
    isConnecting,
    isTesting,
    isUpdatingLimit,
  } = useLinkedInAccounts();

  // Helper function to show toast
  const showToast = (message, type = 'success', duration = 5000) => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: '', type: 'success' }), duration);
  };

  // Redirect if not authenticated or not admin (accounts page is admin-only)
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

  const totalPages = Math.ceil(accounts.length / accountsPerPage);
  const startIndex = (currentPage - 1) * accountsPerPage;
  const paginatedAccounts = accounts.slice(startIndex, startIndex + accountsPerPage);

  const handleSelectAccount = (accountId) => {
    setSelectedAccounts(prev => 
      prev.includes(accountId) 
        ? prev.filter(id => id !== accountId)
        : [...prev, accountId]
    );
  };

  const handleSelectAll = () => {
    if (selectedAccounts.length === paginatedAccounts.length) {
      setSelectedAccounts([]);
    } else {
      setSelectedAccounts(paginatedAccounts.map(account => account.id));
    }
  };

  const handleLinkedInConnect = async () => {
    console.log('🔗 handleLinkedInConnect called');
    
    // Prevent multiple simultaneous connection attempts
    if (isConnecting) {
      console.log('⚠️ Connection already in progress, ignoring duplicate call');
      return;
    }

    // Validate credentials
    if (!linkedInCredentials.email || !linkedInCredentials.password) {
      showToast('Please enter both email and password', 'error');
      return;
    }

    console.log('🚀 Starting LinkedIn connection with email:', linkedInCredentials.email);

    try {
      const result = await connectAccount(linkedInCredentials.email, linkedInCredentials.password);
      
      // Success
      setShowLinkedInModal(false);
      setLinkedInCredentials({ email: '', password: '' });
      showToast('LinkedIn account connected successfully!', 'success', 3000);

      // Show debug screenshots on success too (for verification)
      if (result.debugScreenshots?.length) {
        setDebugScreenshots(result.debugScreenshots);
        setDebugScreenshotIndex(0);
        setShowDebugModal(true);
      }
      
    } catch (error) {
      console.log('❌ Connection error caught in frontend:', error);
      
      let errorMessage = 'Failed to connect LinkedIn account';
      if (error.message.includes('CONNECTION_IN_PROGRESS')) {
        errorMessage = 'A LinkedIn connection is already in progress. Please wait.';
      } else if (error.message.includes('INVALID_CREDENTIALS')) {
        errorMessage = 'Invalid email or password.';
      } else if (error.message.includes('2FA_NOT_SUPPORTED')) {
        errorMessage = '2FA is enabled on this account. Disable it in LinkedIn security settings and retry.';
      } else if (error.message.includes('LOGIN_TIMEOUT')) {
        errorMessage = 'Login timed out. Please try again.';
      } else if (error.message.includes('LOGIN_FAILED')) {
        errorMessage = 'LinkedIn login failed. Check your credentials.';
      } else {
        errorMessage = error.message || errorMessage;
      }
      
      showToast(errorMessage, 'error');

      // Always show debug screenshots if available
      if (error.debugScreenshots?.length) {
        setDebugScreenshots(error.debugScreenshots);
        setDebugScreenshotIndex(0);
        setShowDebugModal(true);
      }
    }
  };

  const handleCloseModal = () => {
    setShowLinkedInModal(false);
    setLinkedInCredentials({ email: '', password: '' });
    setShowPassword(false);
  };

  const handleToggleActive = async (accountId, isActive) => {
    try {
      await toggleAccountStatus(accountId, isActive);
    } catch (error) {
      showToast(`Error: ${error.message || 'Failed to update account status'}`, 'error');
    }
  };

  // Configure Daily Limits handlers
  const handleOpenLimitModal = (account) => {
    setSelectedAccountForLimit(account);
    // Clamp to max 30 (in case database has old value > 30)
    setTempDailyLimit(Math.min(account.dailyLimit || 30, 30));
    setShowLimitModal(true);
  };

  const handleSaveDailyLimit = async () => {
    if (!selectedAccountForLimit) return;

    try {
      await updateDailyLimit(selectedAccountForLimit.id, tempDailyLimit);

      showToast(`Daily limit updated to ${tempDailyLimit} for ${selectedAccountForLimit.email}`, 'success');
      setShowLimitModal(false);
      setSelectedAccountForLimit(null);
    } catch (error) {
      showToast(error.message || 'Failed to update daily limit', 'error');
    }
  };

  const incrementLimit = () => {
    if (tempDailyLimit < 30) {
      setTempDailyLimit(prev => prev + 1);
    }
  };

  const decrementLimit = () => {
    if (tempDailyLimit > 1) {
      setTempDailyLimit(prev => prev - 1);
    }
  };

  const handleLimitInputChange = (e) => {
    const value = parseInt(e.target.value);
    if (!isNaN(value)) {
      setTempDailyLimit(Math.max(1, Math.min(30, value)));
    }
  };

  const handleTestSession = async (accountId) => {
    try {
      const result = await testAccountSession(accountId);
      
      if (result.isValid) {
        showToast('✅ Session is valid and working!', 'success', 3000);
      } else {
        showToast(`❌ Session is invalid: ${result.reason}`, 'error', 5000);
      }
    } catch (error) {
      showToast(`Error testing session: ${error.message}`, 'error');
    }
  };


  if (status === "loading") {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center">
        <div className="loading loading-spinner loading-lg text-primary"></div>
      </div>
    );
  }

  if (!session) return null;
  if (session.user?.role !== "admin") return null;

  return (
    <div className="min-h-screen bg-base-100 flex">
      {/* Sidebar */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        activeSection="accounts"
      />

      {/* Main Content */}
      <div className={`flex-1 transition-all duration-300 ${
        sidebarCollapsed ? "ml-16" : "ml-64"
      } flex flex-col`}>
        {/* Top Bar */}
        <TopBar title="Accounts" />

        {/* Content Area */}
        <div className="flex-1 p-6">
          {/* LinkedIn Tab */}
          <div className="mb-6">
            <div className="flex items-center gap-4 border-b border-base-300">
              <button className="flex items-center gap-2 px-4 py-3 border-b-2 border-primary text-primary font-medium">
                <div className="w-5 h-5 bg-blue-600 rounded flex items-center justify-center">
                  <span className="text-white text-xs font-bold">in</span>
                </div>
                LinkedIn
              </button>
            </div>
          </div>

          {/* Add Account Button */}
          <div className="mb-6">
            <button 
              className="btn btn-primary gap-2"
              onClick={() => setShowLinkedInModal(true)}
            >
              <Plus className="h-4 w-4" />
              Add Account
            </button>
          </div>


          {/* Pagination Controls */}
          <div className="flex items-center justify-end mb-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-base-content/60">
                {startIndex + 1} / {Math.min(startIndex + accountsPerPage, accounts.length)} of {accounts.length}
              </span>
              
              <div className="flex items-center gap-1">
                <button 
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="btn btn-ghost btn-sm btn-circle"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                
                <span className="px-3 py-1 text-sm font-medium bg-primary text-primary-content rounded">
                  {currentPage}
                </span>
                
                <button 
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="btn btn-ghost btn-sm btn-circle"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              
              <select className="select select-bordered select-sm">
                <option value="10">10 / page</option>
                <option value="25">25 / page</option>
                <option value="50">50 / page</option>
              </select>
            </div>
          </div>

          {/* Accounts Table */}
          <div className="card bg-base-100 border border-base-300 overflow-hidden shadow-sm">
            {/* Table Header */}
            <div className="bg-base-200 px-6 py-4 border-b border-base-300">
              <div className="grid grid-cols-12 gap-6 items-center text-sm font-medium text-base-content/70 uppercase tracking-wider">
                <div className="col-span-1">
                  <input
                    type="checkbox"
                    checked={selectedAccounts.length === paginatedAccounts.length && paginatedAccounts.length > 0}
                    onChange={handleSelectAll}
                    className="checkbox checkbox-sm"
                  />
                </div>
                <div className="col-span-3">Account Info</div>
                <div className="col-span-2">Active</div>
                <div className="col-span-3">Daily Limits</div>
                <div className="col-span-3">Action</div>
              </div>
            </div>

            {/* Table Body */}
            <div className="divide-y divide-base-300">
              {isLoadingAccounts ? (
                <div className="py-12 text-center">
                  <div className="loading loading-spinner loading-lg text-primary"></div>
                  <p className="mt-4 text-base-content/60">Loading LinkedIn accounts...</p>
                </div>
              ) : paginatedAccounts.map((account) => {
                
                return (
                  <div key={account.id} className="px-6 py-5 hover:bg-base-50 transition-colors border-b border-base-200 last:border-b-0">
                    <div className="grid grid-cols-12 gap-6 items-center">
                      {/* Selection */}
                      <div className="col-span-1">
                        <input
                          type="checkbox"
                          checked={selectedAccounts.includes(account.id)}
                          onChange={() => handleSelectAccount(account.id)}
                          className="checkbox checkbox-sm"
                        />
                      </div>

                      {/* Account Info */}
                      <div className="col-span-3">
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            {account.profileImageUrl ? (
                              <>
                                <Image 
                                  src={account.profileImageUrl} 
                                  alt={account.name}
                                  width={40}
                                  height={40}
                                  className="w-10 h-10 rounded-full object-cover"
                                  onError={(e) => {
                                    // Hide image and show fallback
                                    e.target.style.display = 'none';
                                    e.target.nextSibling.style.display = 'flex';
                                  }}
                                />
                                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center absolute inset-0" style={{display: 'none'}}>
                                  <span className="text-white font-medium text-sm">
                                    {account.name.split(' ').map(n => n[0]).join('')}
                                  </span>
                                </div>
                              </>
                            ) : (
                              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center">
                                <span className="text-white font-medium text-sm">
                                  {account.name.split(' ').map(n => n[0]).join('')}
                                </span>
                              </div>
                            )}
                            <div className={`absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center ${
                              account.salesNavActive ? 'bg-success' : 'bg-base-300'
                            }`}>
                              <div className="w-2 h-2 bg-white rounded-full"></div>
                            </div>
                          </div>
                          
                          <div className="min-w-0">
                            <div className="font-medium text-base-content truncate">
                              {account.name}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs text-base-content/40">
                                Added {account.addedDate}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                       {/* Active Status */}
                       <div className="col-span-2">
                         <input
                           type="checkbox"
                           className="toggle toggle-primary toggle-lg"
                           checked={account.isActive || false}
                           onChange={(e) => handleToggleActive(account.id, e.target.checked)}
                           disabled={isLoadingAccounts}
                         />
                       </div>

                      {/* Daily Limits */}
                      <div className="col-span-3">
                        <div className="space-y-1 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-base-content/60">Today&apos;s invites</span>
                            <span className="font-medium">{account.dailyInvitesSent}/{account.dailyLimit}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-base-content/60">Follow-up Messages</span>
                            <span className="font-medium">{account.followUpMessages}</span>
                          </div>
                        </div>
                        <button 
                          className="btn btn-outline btn-xs mt-2 gap-1"
                          onClick={() => handleOpenLimitModal(account)}
                        >
                          <Settings className="h-3 w-3" />
                          Configure Daily Limits
                        </button>
                      </div>

                      {/* Actions */}
                      <div className="col-span-3">
                        <div className="flex items-center gap-1">
                          <button className="btn btn-ghost btn-sm btn-circle" title="View Details">
                            <Eye className="h-4 w-4" />
                          </button>
                          <button className="btn btn-ghost btn-sm btn-circle" title="Edit">
                            <Edit className="h-4 w-4" />
                          </button>
                          {/* Test Session Button - Only show for active accounts */}
                          {account.isActive && (
                            <button 
                              className="btn btn-ghost btn-sm btn-circle" 
                              title="Test Session Validity"
                              onClick={() => handleTestSession(account.id)}
                              disabled={isTesting}
                            >
                              {isTesting ? (
                                <div className="loading loading-spinner loading-xs"></div>
                              ) : (
                                <TestTube2 className="h-4 w-4" />
                              )}
                            </button>
                          )}
                           <div className="dropdown dropdown-end">
                             <button className="btn btn-ghost btn-sm btn-circle" title="More actions">
                               <MoreHorizontal className="h-4 w-4" />
                             </button>
                             <ul className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52 border border-base-300">
                               <li><a className="text-sm gap-2"><Users className="h-4 w-4" />Manage Connections</a></li>
                               <li><a className="text-sm gap-2"><MessageSquare className="h-4 w-4" />View Messages</a></li>
                               <li><a className="text-sm gap-2"><Settings className="h-4 w-4" />Account Settings</a></li>
                               <li><hr className="my-1" /></li>
                               <li><a className="text-sm text-error gap-2"><Trash2 className="h-4 w-4" />Remove Account</a></li>
                             </ul>
                           </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Empty State */}
            {accounts.length === 0 && (
              <div className="py-12 text-center">
                <div className="w-16 h-16 bg-base-200 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Users className="h-8 w-8 text-base-content/40" />
                </div>
                <h3 className="text-lg font-medium text-base-content mb-2">No accounts found</h3>
                <p className="text-base-content/60 mb-4">
                  Get started by connecting your first LinkedIn account
                </p>
                <button 
                  className="btn btn-primary gap-2"
                  onClick={() => setShowLinkedInModal(true)}
                >
                  <Plus className="h-4 w-4" />
                  Add LinkedIn Account
                </button>
              </div>
            )}
          </div>

          {/* Pagination Footer */}
          {accounts.length > 0 && (
            <div className="flex items-center justify-between mt-6">
              <div className="text-sm text-base-content/60">
                Showing {startIndex + 1} to {Math.min(startIndex + accountsPerPage, accounts.length)} of {accounts.length} results
              </div>
              
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  className="btn btn-ghost btn-sm"
                >
                  First
                </button>
                <button 
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="btn btn-ghost btn-sm"
                >
                  Previous
                </button>
                
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const page = i + 1;
                    return (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`btn btn-sm ${
                          currentPage === page ? 'btn-primary' : 'btn-ghost'
                        }`}
                      >
                        {page}
                      </button>
                    );
                  })}
                </div>
                
                <button 
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="btn btn-ghost btn-sm"
                >
                  Next
                </button>
                <button 
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className="btn btn-ghost btn-sm"
                >
                  Last
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* LinkedIn Connection Modal */}
      {showLinkedInModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-base-100 rounded-2xl shadow-2xl w-full max-w-md mx-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-base-300">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center">
                  <span className="text-white text-sm font-bold">in</span>
                </div>
                <h3 className="text-lg font-semibold text-base-content">
                  Connect LinkedIn Account
                </h3>
              </div>
              <button 
                onClick={handleCloseModal}
                className="btn btn-ghost btn-sm btn-circle"
                disabled={isConnecting}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6">
              {/* Credential Form */}
              <div className="space-y-4 mb-6">
                <div>
                  <label htmlFor="linkedin-email" className="block text-sm font-medium text-base-content mb-2">
                    LinkedIn Email
                  </label>
                  <input
                    id="linkedin-email"
                    type="email"
                    value={linkedInCredentials.email}
                    onChange={(e) => setLinkedInCredentials(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="Enter your LinkedIn email"
                    className="input input-bordered w-full"
                    disabled={isConnecting}
                    required
                  />
                </div>
                
                <div>
                  <label htmlFor="linkedin-password" className="block text-sm font-medium text-base-content mb-2">
                    LinkedIn Password
                  </label>
                  <div className="relative">
                    <input
                      id="linkedin-password"
                      type={showPassword ? "text" : "password"}
                      value={linkedInCredentials.password}
                      onChange={(e) => setLinkedInCredentials(prev => ({ ...prev, password: e.target.value }))}
                      placeholder="Enter your LinkedIn password"
                      className="input input-bordered w-full pr-10"
                      disabled={isConnecting}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-base-content/40 hover:text-base-content/60 transition-colors"
                      disabled={isConnecting}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Security Notice */}
              <div className="bg-success/10 border border-success/20 rounded-lg p-4 mb-6">
                <div className="flex items-start gap-3">
                  <Shield className="h-5 w-5 text-success flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-medium text-success mb-1">Secure & Automated</h4>
                    <p className="text-xs text-success/80">
                      We use automated browser login to connect your account. Your credentials are used only for login and are not stored permanently.
                    </p>
                  </div>
                </div>
              </div>

              {/* Instructions */}
              <div className="bg-info/10 border border-info/20 rounded-lg p-4 mb-6">
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 bg-blue-600 rounded flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-white text-xs font-bold">in</span>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-info mb-1">How it works</h4>
                    <p className="text-xs text-info/80">
                      1. Enter your LinkedIn credentials above<br/>
                      2. Click &quot;Connect LinkedIn&quot; below<br/>
                      3. We&apos;ll automatically log in to your account<br/>
                      4. Your session will be captured for automation
                    </p>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="btn btn-ghost btn-sm flex-1"
                  disabled={isConnecting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleLinkedInConnect}
                  className="btn btn-primary btn-sm flex-1 gap-2"
                  disabled={isConnecting}
                >
                  {isConnecting ? (
                    <>
                      <span className="loading loading-spinner loading-xs"></span>
                      <span className="text-xs">Connecting...</span>
                    </>
                  ) : (
                    <>
                      <div className="w-3 h-3 bg-blue-600 rounded flex items-center justify-center">
                        <span className="text-white text-xs font-bold">in</span>
                      </div>
                      <span className="text-xs">Connect LinkedIn</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Configure Daily Limits Modal */}
      {showLimitModal && selectedAccountForLimit && (
        <div className="modal modal-open">
          <div className="modal-box max-w-md bg-base-100 border border-base-300">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="font-bold text-lg">Configure Daily Limits</h3>
                <p className="text-sm text-base-content/60 mt-1">
                  {selectedAccountForLimit.email}
                </p>
              </div>
              <button
                className="btn btn-sm btn-circle btn-ghost"
                onClick={() => setShowLimitModal(false)}
                disabled={isUpdatingLimit}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Content */}
            <div className="space-y-6">
              {/* Daily Invite Limit */}
              <div>
                <label className="label">
                  <span className="label-text font-medium">Daily Connection Invites</span>
                  <span className="label-text-alt text-xs text-base-content/60">
                    Max: 30/day
                  </span>
                </label>
                
                {/* Increment/Decrement Controls */}
                <div className="flex items-center gap-3">
                  <button
                    className="btn btn-circle btn-outline"
                    onClick={decrementLimit}
                    disabled={tempDailyLimit <= 1 || isUpdatingLimit}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>

                  <div className="flex-1">
                    <input
                      type="number"
                      min="1"
                      max="30"
                      value={tempDailyLimit}
                      onChange={handleLimitInputChange}
                      disabled={isUpdatingLimit}
                      className="input input-bordered w-full text-center text-2xl font-bold"
                    />
                  </div>

                  <button
                    className="btn btn-circle btn-outline"
                    onClick={incrementLimit}
                    disabled={tempDailyLimit >= 30 || isUpdatingLimit}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                </div>

                {/* Visual Progress Bar */}
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-base-content/60 mb-2">
                    <span>Conservative</span>
                    <span>Moderate</span>
                    <span>Maximum</span>
                  </div>
                  <progress
                    className="progress progress-primary w-full"
                    value={tempDailyLimit}
                    max="30"
                  />
                  <p className="text-xs text-base-content/60 mt-2 text-center">
                    {tempDailyLimit < 10 && "Conservative approach - safer for new accounts"}
                    {tempDailyLimit >= 10 && tempDailyLimit < 20 && "Moderate pace - balanced approach"}
                    {tempDailyLimit >= 20 && "Maximum allowed - use with caution"}
                  </p>
                </div>
              </div>

              {/* Info Box */}
              <div className="alert alert-info">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  className="stroke-current shrink-0 w-5 h-5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span className="text-xs">
                  LinkedIn recommends starting with lower limits for new accounts to avoid restrictions.
                </span>
              </div>

              {/* Current Usage Stats */}
              <div className="stats bg-base-200 w-full">
                <div className="stat py-3 px-4">
                  <div className="stat-title text-xs">Today&apos;s Invites</div>
                  <div className="stat-value text-2xl">{selectedAccountForLimit.dailyInvitesSent || 0}</div>
                  <div className="stat-desc text-xs">out of {tempDailyLimit} limit</div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="modal-action">
              <button
                className="btn btn-ghost"
                onClick={() => setShowLimitModal(false)}
                disabled={isUpdatingLimit}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveDailyLimit}
                disabled={isUpdatingLimit}
              >
                {isUpdatingLimit ? (
                  <>
                    <span className="loading loading-spinner loading-sm" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Debug Screenshots Modal */}
      {showDebugModal && debugScreenshots.length > 0 && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-base-100 rounded-xl shadow-2xl w-full max-w-3xl flex flex-col gap-4 p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-base-content">
                Debug Screenshots ({debugScreenshotIndex + 1} / {debugScreenshots.length})
              </h3>
              <button
                className="btn btn-sm btn-circle btn-ghost"
                onClick={() => setShowDebugModal(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Step label + URL */}
            <div className="text-sm text-base-content/70 space-y-0.5">
              <p className="font-medium">{debugScreenshots[debugScreenshotIndex]?.label}</p>
              <p className="text-xs font-mono truncate">{debugScreenshots[debugScreenshotIndex]?.url}</p>
              <p className="text-xs text-base-content/50">{debugScreenshots[debugScreenshotIndex]?.timestamp}</p>
            </div>

            {/* Screenshot */}
            <div className="rounded-lg overflow-hidden border border-base-300 bg-base-200 flex items-center justify-center min-h-[300px]">
              {debugScreenshots[debugScreenshotIndex]?.dataUri ? (
                <img
                  src={debugScreenshots[debugScreenshotIndex].dataUri}
                  alt={debugScreenshots[debugScreenshotIndex].label}
                  className="w-full object-contain"
                />
              ) : (
                <p className="text-sm text-base-content/50">No screenshot available — {debugScreenshots[debugScreenshotIndex]?.error}</p>
              )}
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between">
              <button
                className="btn btn-sm btn-outline gap-1"
                disabled={debugScreenshotIndex === 0}
                onClick={() => setDebugScreenshotIndex(i => i - 1)}
              >
                <ChevronLeft className="h-4 w-4" /> Prev
              </button>

              <div className="flex gap-1">
                {debugScreenshots.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setDebugScreenshotIndex(i)}
                    className={`w-2.5 h-2.5 rounded-full transition-colors ${i === debugScreenshotIndex ? 'bg-primary' : 'bg-base-300'}`}
                  />
                ))}
              </div>

              <button
                className="btn btn-sm btn-outline gap-1"
                disabled={debugScreenshotIndex === debugScreenshots.length - 1}
                onClick={() => setDebugScreenshotIndex(i => i + 1)}
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast.show && (
        <div className="fixed top-4 right-4 z-50">
          <div className={`alert ${
            toast.type === 'error' ? 'alert-error' : 'alert-success'
          } shadow-lg`}>
            <div>
              <span>{toast.message}</span>
            </div>
            <button 
              className="btn btn-sm btn-circle btn-ghost"
              onClick={() => setToast({ show: false, message: '', type: 'success' })}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
