import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { lockScroll } from "@/lib/scrollLock";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: "md" | "lg";
  placement?: "responsive" | "bottom";
  contentClassName?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open dialogs, newest last, so Escape only closes the one on top.
const openModals: string[] = [];

export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
  placement = "responsive",
  contentClassName,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(() => ({
    height: window.visualViewport?.height ?? window.innerHeight,
    top: window.visualViewport?.offsetTop ?? 0,
  }));
  const modalId = useId();
  // Closing on the backdrop only counts when the press began there too.
  // Dragging to select text inside a form and letting go outside the dialog
  // must not throw the form away.
  const pressStartedOnBackdrop = useRef(false);
  // Parents pass a fresh function each render; the latest one is used without
  // restarting the focus handling below.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useLayoutEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;
    const update = () => {
      const next = {
        height: viewport?.height ?? window.innerHeight,
        top: viewport?.offsetTop ?? 0,
      };
      setViewport((current) =>
        current.height === next.height && current.top === next.top
          ? current
          : next,
      );
    };
    update();
    window.addEventListener("resize", update);
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    };
  }, [open]);

  // Focus moves into the dialog, Tab stays inside it, and focus goes back to
  // what opened it when it closes.
  useEffect(() => {
    if (!open) return;
    const unlockScroll = lockScroll();
    openModals.push(modalId);
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;

    const focusable = () =>
      Array.from(dialog?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (element) => element.getClientRects().length > 0,
      );

    if (dialog && !dialog.contains(document.activeElement)) {
      (focusable()[0] ?? dialog).focus();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (openModals[openModals.length - 1] !== modalId) return;
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      unlockScroll();
      const index = openModals.indexOf(modalId);
      if (index >= 0) openModals.splice(index, 1);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [open, modalId]);

  if (!open) return null;
  const bottomAligned = placement === "bottom";

  // Drawn on the page itself, not inside whatever opened it. Inside a spaced
  // layout (space-y-*) or a clipped or stacked parent, the dimmed layer was
  // pushed out of place and left a strip of the page sharp at the edge.
  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-50 flex justify-center bg-slate-900/40 backdrop-blur-sm",
        bottomAligned
          ? "items-end px-0 py-0"
          : "items-end px-3 py-[max(0.5rem,env(safe-area-inset-bottom))] pt-[max(0.5rem,env(safe-area-inset-top))] sm:items-center sm:px-4 sm:py-3",
      )}
      style={{
        top: viewport.top,
        height: viewport.height,
        bottom: "auto",
      }}
      onMouseDown={(event) => {
        pressStartedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (
          pressStartedOnBackdrop.current &&
          event.target === event.currentTarget
        ) {
          onClose();
        }
        pressStartedOnBackdrop.current = false;
      }}
    >
      <div
        ref={dialogRef}
        style={{
          maxHeight: bottomAligned
            ? `${Math.max(viewport.height, 0)}px`
            : `min(90dvh, ${Math.max(viewport.height - 24, 160)}px)`,
        }}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${modalId}-title`}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "flex min-h-0 w-full flex-col bg-white p-4 shadow-xl outline-none sm:p-6 dark:bg-slate-800",
          bottomAligned &&
            "rounded-t-2xl rounded-b-none pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-2xl",
          !bottomAligned &&
            "max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1rem)] rounded-2xl sm:max-h-[90dvh]",
          size === "lg" ? "sm:max-w-2xl" : "sm:max-w-md",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            id={`${modalId}-title`}
            className="text-lg font-semibold text-slate-900 dark:text-slate-50"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div
          className={cn(
            "mt-4 min-h-0 overflow-y-auto overscroll-contain",
            contentClassName,
          )}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
