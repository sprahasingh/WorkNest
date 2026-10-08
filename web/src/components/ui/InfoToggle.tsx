import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import {
  useContextualOverlay,
  type ContextualOverlayCloseReason,
} from "@/hooks/useContextualOverlay";

function triggerIsClippedOut(
  trigger: HTMLElement,
  anchor: DOMRect,
  viewportWidth: number,
  viewportHeight: number,
): boolean {
  const visible = {
    left: 0,
    top: 0,
    right: viewportWidth,
    bottom: viewportHeight,
  };
  for (
    let ancestor = trigger.parentElement;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    const style = window.getComputedStyle(ancestor);
    if (["auto", "scroll", "hidden", "clip"].includes(style.overflowX)) {
      const bounds = ancestor.getBoundingClientRect();
      visible.left = Math.max(visible.left, bounds.left);
      visible.right = Math.min(visible.right, bounds.right);
    }
    if (["auto", "scroll", "hidden", "clip"].includes(style.overflowY)) {
      const bounds = ancestor.getBoundingClientRect();
      visible.top = Math.max(visible.top, bounds.top);
      visible.bottom = Math.min(visible.bottom, bounds.bottom);
    }
  }
  return (
    anchor.right <= visible.left ||
    anchor.left >= visible.right ||
    anchor.bottom <= visible.top ||
    anchor.top >= visible.bottom
  );
}

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
      id={`${controls}-trigger`}
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
  const closeRef = useRef(onClose);
  const frameRef = useRef<number | null>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    maxHeight: number;
  } | null>(null);

  useLayoutEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useLayoutEffect(() => {
    triggerRef.current = document.querySelector(
      `[aria-controls="${CSS.escape(id)}"]`,
    );
  }, [id, open]);

  const positionPanel = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!open || !trigger || !panel) return;
    const anchor = trigger.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const margin = 8;
    const gap = 8;
    const hasBounds = anchor.width > 0 || anchor.height > 0;
    if (
      hasBounds &&
      triggerIsClippedOut(trigger, anchor, viewportWidth, viewportHeight)
    ) {
      closeRef.current();
      return;
    }

    const box = panel.getBoundingClientRect();
    const naturalHeight = Math.max(box.height, panel.scrollHeight);
    const above = Math.max(0, anchor.top - margin - gap);
    const below = Math.max(0, viewportHeight - anchor.bottom - margin - gap);
    const openAbove = below < Math.min(naturalHeight, 240) && above > below;
    const available = openAbove ? above : below;
    const maxHeight = Math.min(
      Math.max(100, viewportHeight - margin * 2),
      Math.max(100, available),
    );
    const panelHeight = Math.min(naturalHeight, maxHeight);
    const left = Math.min(
      Math.max(margin, anchor.left),
      viewportWidth - margin - Math.min(512, viewportWidth - margin * 2),
    );
    const top = openAbove
      ? Math.max(margin, anchor.top - gap - panelHeight)
      : Math.min(anchor.bottom + gap, viewportHeight - margin - panelHeight);
    setPosition((current) =>
      current &&
      current.top === top &&
      current.left === left &&
      current.maxHeight === maxHeight
        ? current
        : { top, left, maxHeight },
    );
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    positionPanel();
    const update = () => {
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        positionPanel();
      });
    };
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [open, positionPanel]);

  const closePanel = (reason?: ContextualOverlayCloseReason) => {
    if (reason === "escape") triggerRef.current?.focus();
    closeRef.current();
  };

  // Inline explanations remain open during scrolling; the single shared
  // contextual listener repositions them and closes them if their trigger
  // leaves the viewport. Other contextual overlays retain scroll dismissal.
  useContextualOverlay(open, triggerRef, panelRef, closePanel, {
    dismissOnScroll: false,
    onScroll: () => {
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        positionPanel();
      });
    },
  });
  if (!open) return null;
  return createPortal(
    <div
      id={id}
      ref={panelRef}
      role="note"
      aria-labelledby={`${id}-trigger`}
      className={cn(
        "fixed z-[90] flex w-[min(32rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-lg bg-slate-50 text-xs leading-relaxed text-slate-600 shadow-xl ring-1 ring-slate-200 ring-inset dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
        className,
      )}
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        maxHeight: position?.maxHeight ?? "calc(100dvh - 1rem)",
        visibility: position ? "visible" : "hidden",
      }}
    >
      <div className="flex shrink-0 justify-end px-1 pt-1">
        <button
          type="button"
          onClick={() => {
            triggerRef.current?.focus();
            closePanel();
          }}
          aria-label="Close information"
          className="flex size-11 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
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
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
        {children}
      </div>
    </div>,
    document.body,
  );
}
