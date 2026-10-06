import { useFocusTrap } from "@/hooks/useFocusTrap";
import { lockScroll } from "@/lib/scrollLock";
import { useEffect, useRef, type ReactNode } from "react";
import { BrandLink } from "@/components/BrandLink";

export function MenuIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  );
}

// The three-line button that opens a MenuPanel.
export function MenuButton({
  open,
  onClick,
}: {
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open menu"
      aria-haspopup="dialog"
      aria-expanded={open}
      className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      <MenuIcon />
    </button>
  );
}

// A panel that slides in from the right like the app's other panels, with the
// WorkNest mark and a close button on top. Used on the landing page and the
// organizations page, so the account menu looks and works the same in both.
export function MenuPanel({
  onClose,
  children,
  footer,
}: {
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  useFocusTrap(panelRef, true);

  useEffect(() => {
    closeRef.current?.focus();
    const unlockScroll = lockScroll();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      unlockScroll();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-slate-900/30 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <nav
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className="absolute inset-y-0 right-0 flex w-[calc(100%-3rem)] max-w-sm flex-col rounded-l-2xl border-l border-slate-200 bg-white shadow-2xl animate-[panel-in-right_260ms_cubic-bezier(0.32,0.72,0,1)] motion-reduce:animate-none dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <BrandLink onSameDestination={onClose} />
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-4">{children}</div>

        {footer && (
          <div className="border-t border-slate-200 p-2 dark:border-slate-800">
            {footer}
          </div>
        )}
      </nav>
    </div>
  );
}

// Who is signed in: avatar initials, name and email.
export function AccountCard({
  user,
}: {
  user: { name: string; email: string };
}) {
  return (
    <div
      aria-label="Signed-in account"
      className="mb-4 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-teal-100 text-sm font-bold text-teal-800 dark:bg-teal-900/60 dark:text-teal-200">
        {user.name
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0])
          .join("")
          .toUpperCase() || "W"}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Signed in as
        </p>
        <p className="mt-0.5 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
          {user.name}
        </p>
        <p className="break-all text-xs text-slate-600 dark:text-slate-400">
          {user.email}
        </p>
      </div>
    </div>
  );
}
