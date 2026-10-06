import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useContextualOverlay } from "@/hooks/useContextualOverlay";

// A small "i" button that shows or hides an explanation, so long help text
// stays out of the way until someone wants it. Pair it with InfoPanel; the
// parent holds the open state so the panel can sit wherever it reads best.
export function InfoButton({
  open,
  onToggle,
  label,
  controls,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  // What the explanation is about, e.g. "About seats".
  label: string;
  // The panel's id.
  controls: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={label}
      title={label}
      className={cn(
        // A 28px tap area around an 18px circle.
        "-m-[5px] inline-flex size-7 shrink-0 items-center justify-center rounded-full align-middle focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-[18px] items-center justify-center rounded-full border font-serif text-[11px] font-bold italic leading-none transition-colors",
          open
            ? "border-teal-600 bg-teal-600 text-white dark:border-teal-400 dark:bg-teal-400 dark:text-slate-900"
            : "border-slate-300 text-slate-500 hover:border-teal-500 hover:text-teal-700 dark:border-slate-600 dark:text-slate-400 dark:hover:border-teal-400 dark:hover:text-teal-300",
        )}
      >
        i
      </span>
    </button>
  );
}

export function InfoPanel({
  id,
  open,
  onClose,
  children,
  className,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    triggerRef.current = document.querySelector(
      `[aria-controls="${CSS.escape(id)}"]`,
    );
  }, [id, open]);
  useContextualOverlay(open, triggerRef, panelRef, onClose);
  if (!open) return null;
  return (
    <div
      id={id}
      ref={panelRef}
      role="note"
      className={cn(
        "relative mt-2 rounded-lg bg-slate-50 py-2 pl-3 pr-9 text-xs leading-relaxed text-slate-600 ring-1 ring-slate-200 ring-inset animate-[fade-in_150ms_ease-out] motion-reduce:animate-none dark:bg-slate-800/70 dark:text-slate-300 dark:ring-slate-700",
        className,
      )}
    >
      {children}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close explanation"
        className="absolute right-1 top-1 flex size-7 items-center justify-center rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
