"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { AnimatePresence, m } from "framer-motion";
import { Menu, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useLenis } from "@/components/providers/LenisProvider";

import { useHydratedReducedMotion } from "@/lib/motion";
const links = [
  ["Features", "features"],
  ["Workflow", "workflow"],
  ["Pricing", "pricing"],
  ["FAQ", "faq"],
] as const;

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const reducedMotion = useHydratedReducedMotion();
  const lenis = useLenis();

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  const scrollTo = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    event.preventDefault();
    setOpen(false);
    if (lenis) lenis.scrollTo(`#${id}`, { offset: -64 });
    else document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
  };

  return (
    <header className={`landing-navbar sticky top-0 z-50 h-16 transition-colors ${scrolled ? "border-b border-border bg-surface/[0.92] backdrop-blur-xl" : "border-b border-transparent bg-transparent"}`} data-navbar data-scrolled={scrolled}>
      <nav aria-label="Primary navigation" className="mx-auto flex h-full w-[min(100%-32px,1200px)] items-center">
        <a className="flex shrink-0 items-center gap-2 text-base font-semibold text-ink" href="#top" onClick={(event) => scrollTo(event, "top")}>
          <span className="grid size-7 place-items-center rounded-full bg-primary text-on-primary"><Zap size={15} fill="currentColor" /></span>
          <span>Raasta-AI</span>
        </a>
        <div className="ml-12 hidden items-center gap-8 md:flex">
          {links.map(([label, id]) => (
            <a data-testid={`nav-${id}`} className="text-sm font-medium text-ink transition-colors duration-150 hover:text-primary motion-reduce:transition-none" href={`#${id}`} key={id} onClick={(event) => scrollTo(event, id)}>{label}</a>
          ))}
        </div>
        <div className="nav-cta ml-auto hidden md:block"><Button onClick={() => { window.location.href = "/signup"; }}>Get Started</Button></div>
        <button aria-expanded={open} aria-label="Toggle navigation" className="ml-auto grid size-10 place-items-center text-ink md:hidden" onClick={() => setOpen((value) => !value)} type="button">
          {open ? <X size={21} /> : <Menu size={21} />}
        </button>
      </nav>
      <AnimatePresence initial={false}>
        {open ? (
          <m.div
            animate={reducedMotion ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            className="absolute inset-x-0 top-16 overflow-hidden border-b border-border bg-surface shadow-lg md:hidden"
            exit={reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            initial={reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
          >
            <div className="mx-auto grid w-[min(100%-32px,1200px)] py-3">
              {links.map(([label, id]) => (
                <a data-testid={`nav-${id}`} className="border-b border-border py-4 text-sm font-medium text-ink last:border-0" href={`#${id}`} key={id} onClick={(event) => scrollTo(event, id)}>{label}</a>
              ))}
              <Button className="mt-4 w-full" onClick={() => { window.location.href = "/signup"; }}>Get Started</Button>
            </div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}