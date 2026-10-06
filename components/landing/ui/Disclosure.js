"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Plus } from "lucide-react";
import { ease } from "./motion";

// One FAQ row. Opening is the motion: the plus turns into a cross, the answer fades in.
// Height is not animated (transform/opacity only); the row simply grows.
const Disclosure = ({ id, question, open, onToggle, children }) => {
  const reduce = useReducedMotion();
  return (
    <li className="border-b border-raasta-line">
      <h4>
        <button
          type="button"
          id={`${id}-q`}
          aria-expanded={open}
          aria-controls={`${id}-a`}
          onClick={onToggle}
          className="flex min-h-11 w-full items-center justify-between gap-6 py-4 text-left text-[17px] font-medium text-raasta-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-raasta-cobalt"
        >
          {question}
          <Plus
            aria-hidden="true"
            className={`h-5 w-5 shrink-0 text-raasta-cobalt transition-transform duration-200 ${open ? "rotate-45" : ""}`}
          />
        </button>
      </h4>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`${id}-a`}
            role="region"
            aria-labelledby={`${id}-q`}
            initial={reduce ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.22, ease }}
          >
            <div className="max-w-[600px] pb-5 text-[17px] leading-[1.6] text-raasta-slate">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
};

export default Disclosure;
