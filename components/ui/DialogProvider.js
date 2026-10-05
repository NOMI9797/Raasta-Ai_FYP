"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

// App-wide replacement for window.confirm() / window.alert().
//   const { confirm, alert } = useDialog();
//   if (!(await confirm({ title: "Delete job?", message: "…", confirmText: "Delete", tone: "danger" }))) return;
//   await alert({ title: "Couldn't publish", message: error.message, tone: "error" });
// Dialogs queue, so two calls in a row show one after the other.

const DialogContext = createContext(null);

const TONES = {
  danger: { icon: AlertTriangle, badge: "bg-error/10 text-error", button: "btn-error" },
  warning: { icon: AlertTriangle, badge: "bg-warning/10 text-warning", button: "btn-warning" },
  info: { icon: Info, badge: "bg-info/10 text-info", button: "btn-primary" },
  success: { icon: CheckCircle2, badge: "bg-success/10 text-success", button: "btn-success" },
  error: { icon: XCircle, badge: "bg-error/10 text-error", button: "btn-primary" },
};

function normalise(options, defaults) {
  const given = typeof options === "string" ? { message: options } : options || {};
  return { ...defaults, ...given };
}

let nextId = 1;

export function DialogProvider({ children }) {
  const [current, setCurrent] = useState(null);
  const currentRef = useRef(null);
  const queue = useRef([]);

  const show = useCallback((request) => new Promise((resolve) => {
    const entry = { ...request, id: nextId++, resolve };
    if (currentRef.current) {
      queue.current.push(entry);
    } else {
      currentRef.current = entry;
      setCurrent(entry);
    }
  }), []);

  const close = useCallback((result) => {
    const entry = currentRef.current;
    if (!entry) return;
    entry.resolve(result);
    const next = queue.current.shift() || null;
    currentRef.current = next;
    setCurrent(next);
  }, []);

  // Never leave a caller waiting forever if the provider goes away
  useEffect(() => () => {
    currentRef.current?.resolve(false);
    queue.current.forEach((entry) => entry.resolve(false));
    queue.current = [];
    currentRef.current = null;
  }, []);

  const api = useMemo(() => ({
    confirm: (options) => show({ kind: "confirm", ...normalise(options, { title: "Are you sure?", confirmText: "Confirm", cancelText: "Cancel", tone: "info" }) }),
    alert: (options) => show({ kind: "alert", ...normalise(options, { title: "Heads up", confirmText: "OK", tone: "info" }) }).then(() => undefined),
  }), [show]);

  return (
    <DialogContext.Provider value={api}>
      {children}
      {current && <DialogView key={current.id} entry={current} onClose={close} />}
    </DialogContext.Provider>
  );
}

function DialogView({ entry, onClose }) {
  const ref = useRef(null);
  const confirmRef = useRef(null);
  const cancelRef = useRef(null);
  const tone = TONES[entry.tone] || TONES.info;
  const Icon = tone.icon;
  const isConfirm = entry.kind === "confirm";
  const titleId = `dialog-title-${entry.id}`;
  const bodyId = `dialog-body-${entry.id}`;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    // A destructive question starts on "Cancel" so Enter never deletes by accident
    const first = entry.tone === "danger" && cancelRef.current ? cancelRef.current : confirmRef.current;
    first?.focus();
  }, [entry]);

  // Escape closes this dialog only. The browser would send the same close request to every modal underneath
  // (a panel that opened this question), so the key is handled here and the default action is cancelled.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose(false);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const items = Array.isArray(entry.items) ? entry.items : [];

  return (
    <dialog
      ref={ref}
      className="modal"
      data-app-dialog
      role={isConfirm ? "alertdialog" : "dialog"}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(event) => {
        event.preventDefault(); // a close request that did not come from the Escape key
        onClose(false);
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose(false); // backdrop
      }}
    >
      <div className="modal-box max-w-md">
        <div className="flex gap-4">
          <div className={`shrink-0 h-10 w-10 rounded-full flex items-center justify-center ${tone.badge}`}>
            <Icon size={20} />
          </div>
          <div className="min-w-0">
            <h3 id={titleId} className="font-semibold text-lg leading-snug">{entry.title}</h3>
            <div id={bodyId} className="mt-1 text-sm text-base-content/70 space-y-2">
              {entry.message && <p className="whitespace-pre-line break-words">{entry.message}</p>}
              {items.length > 0 && (
                <ul className="list-disc pl-5 space-y-0.5">
                  {items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              )}
            </div>
          </div>
        </div>
        <div className="modal-action">
          {isConfirm && (
            <button ref={cancelRef} type="button" className="btn btn-ghost btn-sm !normal-case" onClick={() => onClose(false)}>
              {entry.cancelText}
            </button>
          )}
          <button ref={confirmRef} type="button" className={`btn btn-sm !normal-case ${tone.button}`} onClick={() => onClose(true)}>
            {entry.confirmText}
          </button>
        </div>
      </div>
    </dialog>
  );
}

// Outside the provider (a stray test render) fall back to the browser's own dialogs rather than crash
const FALLBACK = {
  confirm: async (options) => window.confirm([normalise(options).title, normalise(options).message].filter(Boolean).join("\n\n")),
  alert: async (options) => { window.alert([normalise(options).title, normalise(options).message].filter(Boolean).join("\n\n")); },
};

export function useDialog() {
  return useContext(DialogContext) || FALLBACK;
}
