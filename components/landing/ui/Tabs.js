"use client";

import { motion } from "framer-motion";
import { spring } from "./motion";

// Roving-tabindex keyboard handling shared by every tablist on the page.
export const tabKeyHandler = (count, setActive, { vertical = false, onUser } = {}) => (e) => {
  const next = vertical ? ["ArrowDown", "ArrowRight"] : ["ArrowRight"];
  const prev = vertical ? ["ArrowUp", "ArrowLeft"] : ["ArrowLeft"];
  // Read the tabs now: React clears e.currentTarget once the handler returns.
  const tabEls = [...e.currentTarget.querySelectorAll('[role="tab"]')];
  const current = Math.max(0, tabEls.indexOf(document.activeElement));
  let i;
  if (next.includes(e.key)) i = (current + 1) % count;
  else if (prev.includes(e.key)) i = (current - 1 + count) % count;
  else if (e.key === "Home") i = 0;
  else if (e.key === "End") i = count - 1;
  else return;
  e.preventDefault();
  onUser?.();
  setActive(i);
  tabEls[i]?.focus();
};

// Segmented control. The selected pill slides to answer the click (the only motion here).
export const SegmentedTabs = ({ tabs, active, setActive, idPrefix, label }) => (
  <div
    role="tablist"
    aria-label={label}
    onKeyDown={tabKeyHandler(tabs.length, setActive)}
    className="no-scrollbar inline-flex max-w-full gap-1 overflow-x-auto rounded-card max-sm:flex-wrap border border-raasta-line bg-raasta-white p-1"
  >
    {tabs.map((t, i) => {
      const isActive = i === active;
      return (
        <button
          key={t.id}
          role="tab"
          type="button"
          id={`${idPrefix}-tab-${t.id}`}
          aria-selected={isActive}
          aria-controls={`${idPrefix}-panel`}
          tabIndex={isActive ? 0 : -1}
          onClick={() => setActive(i)}
          className={`relative h-11 shrink-0 rounded-control px-4 text-[16px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-raasta-cobalt ${
            isActive ? "text-raasta-cobaltDeep" : "text-raasta-slate hover:text-raasta-navy"
          }`}
        >
          {isActive && (
            <motion.span layoutId={`${idPrefix}-pill`} className="absolute inset-0 rounded-control bg-raasta-wash" transition={spring} />
          )}
          <span className="relative">{t.label}</span>
        </button>
      );
    })}
  </div>
);
