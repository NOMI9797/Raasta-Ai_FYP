"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, m } from "framer-motion";
import { BriefcaseBusiness, CirclePause, CirclePlay, FileSearch, FileText, Gauge, Linkedin, Mail, MessageSquareText, RefreshCw, Send, ShieldCheck, Upload, UserRoundCheck, Users, XCircle, Zap, type LucideIcon } from "lucide-react";
import { DitherField } from "@/components/ui/DitherField";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Reveal } from "@/components/ui/Reveal";
import { useHydratedReducedMotion } from "@/lib/motion";

type Item = { label: string; icon: LucideIcon };
type Paths = { main: string; branches: string[] };

const workflows: Array<{ label: string; testId: string; input: Item; outputs: Item[] }> = [
  { label: "Outreach", testId: "outreach", input: { label: "Lead CSV", icon: Upload }, outputs: [{ label: "Scrape posts", icon: FileSearch }, { label: "Generate message", icon: MessageSquareText }, { label: "Send invite", icon: Send }, { label: "Track acceptance", icon: UserRoundCheck }] },
  { label: "Hiring", testId: "hiring", input: { label: "Job preferences", icon: BriefcaseBusiness }, outputs: [{ label: "AI job post", icon: FileText }, { label: "Publish to LinkedIn", icon: Linkedin }, { label: "Collect CVs", icon: Users }, { label: "Parse resume", icon: FileSearch }] },
  { label: "Live Monitoring", testId: "live-monitoring", input: { label: "Job started", icon: Gauge }, outputs: [{ label: "Pause", icon: CirclePause }, { label: "Resume", icon: CirclePlay }, { label: "Cancel", icon: XCircle }, { label: "Live status", icon: RefreshCw }] },
  { label: "Roles & Access", testId: "roles-access", input: { label: "Admin", icon: ShieldCheck }, outputs: [{ label: "Sales operator", icon: Mail }, { label: "Recruiter", icon: Users }, { label: "Candidate form", icon: FileText }, { label: "Role dashboards", icon: Gauge }] },
];

const emptyPaths: Paths = { main: "", branches: [] };

export function Workflow() {
  const [active, setActive] = useState(0);
  const [paths, setPaths] = useState<Paths>(emptyPaths);
  const stageRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const nodeRef = useRef<HTMLDivElement>(null);
  const outputRefs = useRef<Array<HTMLDivElement | null>>([]);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const reducedMotion = useHydratedReducedMotion();
  const current = workflows[active];
  const InputIcon = current.input.icon;

  const measure = useCallback(() => {
    const stage = stageRef.current;
    const input = inputRef.current;
    const node = nodeRef.current;
    const outputs = outputRefs.current.slice(0, 4);
    if (!stage || !input || !node || outputs.length !== 4 || outputs.some((item) => !item)) return;

    const root = stage.getBoundingClientRect();
    const relative = (element: Element) => {
      const box = element.getBoundingClientRect();
      return {
        left: box.left - root.left,
        right: box.right - root.left,
        top: box.top - root.top,
        bottom: box.bottom - root.top,
        cx: box.left - root.left + box.width / 2,
        cy: box.top - root.top + box.height / 2,
      };
    };

    const source = relative(input);
    const center = relative(node);
    const mobile = root.width < 768;
    const next: Paths = mobile
      ? {
          main: `M ${source.cx} ${source.bottom} L ${center.cx} ${center.top}`,
          branches: outputs.map((item) => {
            const target = relative(item!);
            return `M ${center.cx} ${center.bottom} L ${target.cx} ${target.top}`;
          }),
        }
      : {
          main: `M ${source.right} ${source.cy} L ${center.left} ${center.cy}`,
          branches: outputs.map((item) => {
            const target = relative(item!);
            const distance = target.left - center.right;
            const tangent = Math.max(36, distance * 0.52);
            return `M ${center.right} ${center.cy} C ${center.right + tangent} ${center.cy}, ${target.left - tangent} ${target.cy}, ${target.left} ${target.cy}`;
          }),
        };

    setPaths((previous) => previous.main === next.main && previous.branches.every((path, index) => path === next.branches[index]) ? previous : next);
  }, []);

  useLayoutEffect(() => {
    let frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    const elements = [stageRef.current, inputRef.current, nodeRef.current, ...outputRefs.current].filter(Boolean) as Element[];
    elements.forEach((element) => observer.observe(element));
    document.fonts?.ready.then(() => measure());
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [measure]);

  useEffect(() => {
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [active, measure]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % workflows.length;
    if (event.key === "ArrowLeft") next = (index - 1 + workflows.length) % workflows.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = workflows.length - 1;
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  const allPaths = [paths.main, ...paths.branches].filter(Boolean);

  return (
    <section className="scroll-mt-16 py-16 md:py-24" data-testid="section-workflow" id="workflow">
      <Reveal className="mx-auto w-[min(100%-32px,1200px)]">
        <div className="text-center">
          <Eyebrow className="justify-center">Workflows</Eyebrow>
          <h2 className="mx-auto mt-4 max-w-[680px] text-[clamp(2.25rem,5vw,2.75rem)] font-medium leading-[1.1] tracking-[-0.03em] text-ink">Every workflow, automated end to end.</h2>
        </div>
        <div aria-label="Workflows" className="mt-12 flex h-12 overflow-x-auto border-y border-border" role="tablist">
          {workflows.map((item, index) => (
            <button aria-controls="workflow-panel" aria-selected={active === index} className={"min-w-[160px] flex-1 border-r border-border px-4 text-sm font-medium transition-colors first:border-l " + (active === index ? "bg-primary-soft text-ink" : "bg-surface text-muted hover:text-ink")} data-testid={"workflow-tab-" + item.testId} id={"workflow-tab-" + index} key={item.label} onClick={() => setActive(index)} onKeyDown={(event) => onKeyDown(event, index)} ref={(element) => { tabRefs.current[index] = element; }} role="tab" tabIndex={active === index ? 0 : -1} type="button">{item.label}</button>
          ))}
        </div>
        <div className="relative aspect-[16/7] min-h-[420px] overflow-hidden bg-primary md:min-h-0" data-testid="workflow-panel" id="workflow-panel" ref={stageRef} role="tabpanel">
          <DitherField variant="hero" />
          <svg aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 size-full overflow-visible">
            <AnimatePresence initial={false} mode="wait">
              <m.g key={`${active}-${paths.main}`}>
                {allPaths.map((path, index) => {
                  const delay = reducedMotion ? 0 : index * 0.07;
                  return (
                    <g key={`${active}-${index}`}>
                      <m.path animate={{ strokeDashoffset: 0 }} d={path} fill="none" initial={{ strokeDashoffset: reducedMotion ? 0 : 1 }} pathLength={1} stroke="var(--primary)" strokeDasharray="1" strokeLinecap="round" strokeWidth="4" transition={{ duration: reducedMotion ? 0 : 0.5, delay, ease: "easeOut" }} />
                      <m.path animate={{ strokeDashoffset: 0 }} d={path} fill="none" initial={{ strokeDashoffset: reducedMotion ? 0 : 1 }} pathLength={1} stroke="white" strokeDasharray="1" strokeLinecap="round" strokeOpacity="0.95" strokeWidth="2" transition={{ duration: reducedMotion ? 0 : 0.5, delay, ease: "easeOut" }} />
                      {!reducedMotion ? <circle fill="white" r="3"><animateMotion begin={`${index * 0.22}s`} dur="3s" path={path} repeatCount="indefinite" /></circle> : null}
                    </g>
                  );
                })}
              </m.g>
            </AnimatePresence>
          </svg>

          <div className="absolute inset-0 z-20">
            <div className="workflow-pill absolute left-1/2 top-6 -translate-x-1/2 md:left-[5%] md:top-1/2 md:-translate-x-0 md:-translate-y-1/2" data-testid="workflow-input" ref={inputRef}>
              <AnimatePresence initial={false} mode="wait">
                <m.span animate={{ opacity: 1 }} className="flex items-center gap-2" exit={{ opacity: 0 }} initial={{ opacity: 0 }} key={current.input.label} transition={{ duration: reducedMotion ? 0 : 0.2 }}>
                  <InputIcon className="size-4 text-primary" />{current.input.label}
                </m.span>
              </AnimatePresence>
            </div>

            <div className="workflow-node absolute left-1/2 top-[104px] grid size-24 -translate-x-1/2 place-items-center rounded-3xl bg-dark text-white md:top-1/2 md:-translate-y-1/2" data-testid="workflow-node" ref={nodeRef}>
              <Zap className="size-10" fill="currentColor" strokeWidth={1.5} />
            </div>

            <div className="absolute inset-x-5 bottom-3 top-[220px] grid grid-rows-4 gap-1 md:inset-y-[7%] md:left-auto md:right-[5%] md:w-[24%] md:gap-0">
              {current.outputs.map(({ label, icon: Icon }, index) => (
                <div className="workflow-pill self-center justify-self-center md:justify-self-start" data-testid="workflow-output" key={index} ref={(element) => { outputRefs.current[index] = element; }}>
                  <AnimatePresence initial={false} mode="wait">
                    <m.span animate={{ opacity: 1 }} className="flex items-center gap-2" exit={{ opacity: 0 }} initial={{ opacity: 0 }} key={label} transition={{ duration: reducedMotion ? 0 : 0.2 }}>
                      <Icon className="size-4 text-primary" />{label}
                    </m.span>
                  </AnimatePresence>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
