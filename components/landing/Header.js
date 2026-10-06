"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Menu, X } from "lucide-react";
import Logo from "./Logo";
import { ease, spring } from "./ui/motion";
import config from "@/config";

// Floating glass navbar.
// - 12px from the top, max 1200px wide, 16px radius. 72px tall, 60px once scrolled.
// - Shadow appears after 20px of scroll.
// - Light glass by default; dark glass while it sits over a [data-nav-theme="dark"] area.
// - Scrollspy: the active link gets a light-blue pill; a second pill slides under the hovered link.
// Blog is hidden until it has real posts.

const links = [
  { href: "#solution", label: "Product", section: "solution" },
  { href: "#workflow", label: "Client acquisition", section: "workflow" },
  { href: "#hiring", label: "Hiring", section: "workflow" },
  { href: "#pricing", label: "Pricing", section: "pricing" },
  { href: "#faq", label: "FAQ", section: "faq" },
];

const NAV_TOP = 12;
const PROBE = 120; // px from the top: the section crossing this line is "active"

// The workflow section holds both Client acquisition and Hiring; #hiring picks Hiring.
const activeFor = (sectionId, hash) => {
  if (sectionId === "workflow") return hash === "#hiring" ? "Hiring" : "Client acquisition";
  return links.find((l) => l.section === sectionId)?.label ?? null;
};

const Header = () => {
  const { status } = useSession();
  const reduce = useReducedMotion();
  const [scrolled, setScrolled] = useState(false);
  const [dark, setDark] = useState(false);
  const [active, setActive] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [open, setOpen] = useState(false);
  const barRef = useRef(null);
  const sheetRef = useRef(null);
  const authed = status === "authenticated";

  // One rAF-throttled scroll handler: scrolled state, dark/light theme, scrollspy.
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      setScrolled(window.scrollY > 20);

      const bar = barRef.current?.getBoundingClientRect();
      const mid = bar ? bar.top + bar.height / 2 : NAV_TOP + 36;
      const overDark = [...document.querySelectorAll('[data-nav-theme="dark"]')].some((el) => {
        const r = el.getBoundingClientRect();
        return r.top <= mid && r.bottom >= mid;
      });
      setDark(overDark);

      let current = null;
      for (const id of ["solution", "workflow", "pricing", "faq"]) {
        const el = document.getElementById(id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.top <= PROBE && r.bottom > PROBE) current = id;
      }
      setActive(current ? activeFor(current, window.location.hash) : null);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("hashchange", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("hashchange", onScroll);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    sheetRef.current?.querySelector("a,button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const onDark = dark && !open;

  const linkCls = (isActive) =>
    `relative z-10 inline-flex h-10 items-center rounded-[10px] px-3 text-[15px] font-medium transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-raasta-cobalt ${
      isActive
        ? onDark
          ? "text-raasta-white"
          : "text-raasta-cobaltDeep"
        : onDark
          ? "text-raasta-white/75 hover:text-raasta-white"
          : "text-raasta-slate hover:text-raasta-navy"
    }`;

  const loginCls = `inline-flex h-10 items-center rounded-[10px] border px-4 text-[15px] font-medium transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-raasta-cobalt ${
    onDark
      ? "border-raasta-white/30 text-raasta-white hover:border-raasta-white hover:bg-raasta-white/10"
      : "border-raasta-line bg-raasta-white text-raasta-navy hover:border-raasta-slate/50"
  }`;

  const signupCls =
    "inline-flex h-10 items-center rounded-[10px] bg-raasta-cobalt px-4 text-[15px] font-medium text-raasta-white transition-colors duration-200 hover:bg-raasta-cobaltDeep active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-raasta-cobalt focus-visible:ring-offset-2";

  return (
    <div className="pointer-events-none fixed inset-x-0 z-50 px-3 sm:px-4" style={{ top: NAV_TOP }}>
      <header
        ref={barRef}
        className={`pointer-events-auto mx-auto w-full max-w-[1200px] rounded-[16px] border backdrop-blur-md transition-[background-color,border-color,box-shadow] duration-300 ${
          onDark
            ? "border-raasta-white/10 bg-raasta-navy/70"
            : open
              ? "border-raasta-line bg-raasta-white/[0.97]"
              : "border-raasta-line bg-raasta-white/85"
        } ${scrolled || open ? "shadow-[0_12px_32px_-16px_rgb(var(--raasta-navy)/0.35)]" : ""}`}
      >
        <nav
          aria-label="Main"
          className={`flex items-center justify-between gap-4 px-3 transition-[height] duration-300 sm:px-4 ${
            scrolled ? "h-[60px]" : "h-[72px]"
          }`}
        >
          <Logo tone={onDark ? "dark" : "light"} />

          <ul className="hidden items-center gap-0.5 lg:flex" onMouseLeave={() => setHovered(null)}>
            {links.map((l) => {
              const isActive = active === l.label;
              return (
                <li key={l.label} className="relative">
                  {isActive && (
                    <motion.span
                      layoutId="nav-active"
                      aria-hidden="true"
                      className={`absolute inset-0 rounded-[10px] transition-colors duration-300 ${onDark ? "bg-raasta-white/15" : "bg-raasta-wash"}`}
                      transition={reduce ? { duration: 0 } : spring}
                    />
                  )}
                  {hovered === l.label && !isActive && (
                    <motion.span
                      layoutId="nav-hover"
                      aria-hidden="true"
                      className={`absolute inset-0 rounded-[10px] ${onDark ? "bg-raasta-white/10" : "bg-raasta-navy/[0.05]"}`}
                      transition={reduce ? { duration: 0 } : spring}
                    />
                  )}
                  <a
                    href={l.href}
                    onMouseEnter={() => setHovered(l.label)}
                    onFocus={() => setHovered(l.label)}
                    aria-current={isActive ? "true" : undefined}
                    className={linkCls(isActive)}
                  >
                    {l.label}
                  </a>
                </li>
              );
            })}
          </ul>

          <div className="hidden items-center gap-2 md:flex">
            {authed ? (
              <Link href={config.auth.callbackUrl} className={signupCls}>
                Open dashboard
              </Link>
            ) : (
              <>
                <Link href="/signin" className={loginCls}>
                  Log in
                </Link>
                <Link href="/signup" className={signupCls}>
                  Sign up
                </Link>
              </>
            )}
          </div>

          <button
            type="button"
            className={`flex h-11 w-11 items-center justify-center rounded-[10px] transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-raasta-cobalt md:hidden ${
              onDark ? "text-raasta-white" : "text-raasta-navy"
            }`}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </nav>

        <AnimatePresence>
          {open && (
            <motion.div
              id="mobile-menu"
              ref={sheetRef}
              className="border-t border-raasta-line px-3 pb-4 pt-2 md:hidden"
              initial={reduce ? false : { opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease }}
            >
              <ul className="flex flex-col">
                {links.map((l) => (
                  <li key={l.label}>
                    <a
                      href={l.href}
                      onClick={() => setOpen(false)}
                      aria-current={active === l.label ? "true" : undefined}
                      className={`flex min-h-11 items-center rounded-[10px] px-3 text-[17px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-raasta-cobalt ${
                        active === l.label ? "bg-raasta-wash text-raasta-cobaltDeep" : "text-raasta-navy hover:bg-raasta-mist"
                      }`}
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-raasta-line pt-4">
                {authed ? (
                  <Link
                    href={config.auth.callbackUrl}
                    onClick={() => setOpen(false)}
                    className={`${signupCls} col-span-2 h-11 justify-center`}
                  >
                    Open dashboard
                  </Link>
                ) : (
                  <>
                    <Link href="/signin" onClick={() => setOpen(false)} className={`${loginCls} h-11 justify-center`}>
                      Log in
                    </Link>
                    <Link href="/signup" onClick={() => setOpen(false)} className={`${signupCls} h-11 justify-center`}>
                      Sign up
                    </Link>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>
    </div>
  );
};

export default Header;
