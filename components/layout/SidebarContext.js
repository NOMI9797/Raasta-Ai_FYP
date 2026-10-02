"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { SIDEBAR_COOKIE } from "./sidebar-cookie";

const SidebarContext = createContext(null);

function saveCollapsed(collapsed) {
  document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
}

// Holds the sidebar's collapsed state above the pages, so it survives navigation,
// and mirrors user changes to a cookie so the server renders the same state after a reload.
export function SidebarProvider({ initialCollapsed = true, children }) {
  const [collapsed, setCollapsedState] = useState(initialCollapsed);

  // On phones the expanded sidebar covers the page, so start collapsed there.
  // Not saved: the cookie keeps the desktop preference.
  useEffect(() => {
    if (!initialCollapsed && window.matchMedia("(max-width: 767px)").matches) {
      setCollapsedState(true);
    }
  }, [initialCollapsed]);

  const setCollapsed = useCallback((value) => {
    setCollapsedState((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
      saveCollapsed(next);
      return next;
    });
  }, []);

  const toggle = useCallback(() => setCollapsed((c) => !c), [setCollapsed]);

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed, toggle }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  const [localCollapsed, setLocalCollapsed] = useState(true);
  if (ctx) return ctx;
  // Outside the dashboard layout: behave like the old per-page state
  return {
    collapsed: localCollapsed,
    setCollapsed: setLocalCollapsed,
    toggle: () => setLocalCollapsed((c) => !c),
  };
}
