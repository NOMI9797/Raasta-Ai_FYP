"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import {
  Bell,
  Moon,
  Sun,
  User,
  LogOut,
  Settings,
} from "lucide-react";

export default function TopBar({ title = "Campaigns", showStatus = true }) {
  const { data: session } = useSession();
  const [theme, setTheme] = useState("reachly");
  const [showUserMenu, setShowUserMenu] = useState(false);

  useEffect(() => {
    // Get theme from localStorage or use our custom theme
    const savedTheme = localStorage.getItem("theme");
    const currentTheme = savedTheme || "reachly";
    
    setTheme(currentTheme);
    document.documentElement.setAttribute("data-theme", currentTheme);
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === "reachly" ? "reachly-dark" : "reachly";
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
  };

  const handleLogout = () => {
    // This would typically call a logout API
    window.location.href = "/api/auth/signout";
  };

  return (
    <header className="h-16 bg-base-100 border-b border-base-300 px-6 flex items-center justify-between z-40">
      {/* Left Section */}
      <div className="flex items-center gap-6">
        <div>
          <h1 className="text-xl font-semibold text-base-content">{title}</h1>
          {showStatus && (
            <div className="flex items-center gap-4 mt-1">
              <div className="badge badge-success badge-sm">
                <div className="w-2 h-2 bg-success rounded-full mr-1"></div>
                Ready
              </div>
              <span className="text-sm text-base-content/60">Dashboard loaded</span>
            </div>
          )}
        </div>
      </div>

      {/* Right Section */}
      <div className="flex items-center gap-4">
        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="btn btn-ghost btn-sm btn-circle"
          aria-label="Toggle theme"
        >
          {theme === "reachly" ? (
            <Moon className="h-4 w-4" />
          ) : (
            <Sun className="h-4 w-4" />
          )}
        </button>

        {/* Notifications */}
        <button className="btn btn-ghost btn-sm btn-circle relative">
          <Bell className="h-4 w-4" />
          <div className="absolute -top-1 -right-1 w-3 h-3 bg-error rounded-full"></div>
        </button>

        {/* User Menu */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="btn btn-ghost btn-sm btn-circle"
            aria-label="User menu"
          >
            {session?.user?.image ? (
              <img
                src={session.user.image}
                alt="User avatar"
                className="w-8 h-8 rounded-full"
              />
            ) : (
              <User className="h-4 w-4" />
            )}
          </button>

          {/* Dropdown Menu */}
          {showUserMenu && (
            <div className="absolute right-0 mt-2 w-48 bg-base-100 border border-base-300 rounded-lg shadow-lg z-50">
              <div className="p-3 border-b border-base-300">
                <div className="text-sm font-semibold text-base-content">
                  {session?.user?.name || "User"}
                </div>
                <div className="text-xs text-base-content/60">
                  {session?.user?.email}
                </div>
              </div>
              <div className="py-1">
                <button className="w-full px-3 py-2 text-left text-sm hover:bg-base-200 flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  Settings
                </button>
                <button
                  onClick={handleLogout}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-base-200 flex items-center gap-2 text-error"
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Click outside to close user menu */}
      {showUserMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowUserMenu(false)}
        />
      )}
    </header>
  );
}

