import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { useContextualOverlay } from "@/hooks/useContextualOverlay";

interface MoreMenuProps {
  label: string;
  children: React.ReactNode;
  className?: string;
  triggerText?: string;
}

export function MoreMenu({
  label,
  children,
  className,
  triggerText,
}: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    maxHeight: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useContextualOverlay(open, triggerRef, menuRef, () => setOpen(false));
  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const anchor = trigger.getBoundingClientRect();
      const bounds = menu.getBoundingClientRect();
      const margin = 8;
      const gap = 4;
      const below = window.innerHeight - anchor.bottom - margin - gap;
      const above = anchor.top - margin - gap;
      const openAbove = below < Math.min(bounds.height, 180) && above > below;
      const maxHeight = Math.max(80, openAbove ? above : below);
      const height = Math.min(bounds.height, maxHeight);
      setPosition({
        top: openAbove
          ? Math.max(margin, anchor.top - height - gap)
          : Math.min(anchor.bottom + gap, window.innerHeight - height - margin),
        left: Math.min(
          Math.max(margin, anchor.right - bounds.width),
          window.innerWidth - bounds.width - margin,
        ),
        maxHeight,
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);
  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        ref={triggerRef}
        aria-label={triggerText ?? `${label} actions`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex h-11 cursor-pointer list-none items-center justify-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-500 [&::-webkit-details-marker]:hidden",
          triggerText
            ? "min-w-11 border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            : "w-11 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700",
        )}
      >
        {triggerText ?? (
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-5 w-5"
            aria-hidden="true"
          >
            <circle cx="5" cy="12" r="1.7" />
            <circle cx="12" cy="12" r="1.7" />
            <circle cx="19" cy="12" r="1.7" />
          </svg>
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-[80] min-w-40 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              maxHeight: position?.maxHeight ?? "calc(100dvh - 1rem)",
              visibility: position ? "visible" : "hidden",
            }}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("button, a"))
                setOpen(false);
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function MoreMenuItem({
  tone = "neutral",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "neutral" | "danger";
}) {
  return (
    <button
      type="button"
      {...props}
      role="menuitem"
      className={cn(
        "block min-h-11 w-full rounded-md px-3 py-2 text-left text-sm hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-500 dark:hover:bg-slate-700",
        tone === "danger"
          ? "text-red-600 dark:text-red-400"
          : "text-slate-700 dark:text-slate-200",
        className,
      )}
    />
  );
}
