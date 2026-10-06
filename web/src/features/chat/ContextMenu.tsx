import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useContextualOverlay } from "@/hooks/useContextualOverlay";

export interface MenuItem<Action extends string = string> {
  action: Action;
  label: string;
  danger?: boolean;
}

interface ContextMenuProps<Action extends string> {
  title: string;
  items: MenuItem<Action>[];
  // Where the press happened; null closes the menu.
  anchor: { x: number; y: number; touch: boolean } | null;
  // Extra content above the list, such as a row of quick reactions.
  header?: ReactNode;
  onSelect: (action: Action) => void;
  onClose: () => void;
}

const MENU_WIDTH = 208;

// Opens from a long press, a right click or a "more" button. On a phone it
// slides up from the bottom; with a mouse it sits at the pointer.
export function ContextMenu<Action extends string>({
  title,
  items,
  anchor,
  header,
  onSelect,
  onClose,
}: ContextMenuProps<Action>) {
  const firstRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLElement>(null);
  const closeReasonRef = useRef<string | null>(null);
  const isOpen = anchor !== null;
  useContextualOverlay(isOpen, triggerRef, menuRef, (reason) => {
    closeReasonRef.current = reason;
    onClose();
  });

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    closeReasonRef.current = null;
    firstRef.current?.focus();
    return () => {
      if (
        closeReasonRef.current !== "scroll" &&
        previous &&
        document.contains(previous)
      )
        previous.focus();
    };
  }, [isOpen]);

  if (!anchor) return null;

  const left = Math.max(
    8,
    Math.min(anchor.x, window.innerWidth - MENU_WIDTH - 8),
  );
  const top = Math.max(
    8,
    Math.min(
      anchor.y,
      window.innerHeight - items.length * 40 - (header ? 64 : 0) - 24,
    ),
  );

  const buttons = items.map((item, index) => (
    <li key={item.action}>
      <button
        ref={index === 0 ? firstRef : undefined}
        type="button"
        role="menuitem"
        onClick={() => onSelect(item.action)}
        className={cn(
          "flex w-full items-center px-4 py-3 text-left text-sm font-medium hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none dark:hover:bg-slate-700 dark:focus-visible:bg-slate-700",
          anchor.touch ? "py-3.5 text-base" : "py-2",
          item.danger
            ? "text-red-600 dark:text-red-400"
            : "text-slate-800 dark:text-slate-100",
        )}
      >
        {item.label}
      </button>
    </li>
  ));

  return (
    <div
      className="fixed inset-0 z-50"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className={cn(
          "absolute inset-0",
          anchor.touch && "bg-slate-900/30 backdrop-blur-[1px]",
        )}
      />
      {anchor.touch ? (
        <div
          ref={menuRef as React.RefObject<HTMLDivElement>}
          role="menu"
          aria-label={`Options for ${title}`}
          className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-slate-200 bg-white pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl animate-[sheet-up_200ms_ease-out] motion-reduce:animate-none dark:border-slate-700 dark:bg-slate-800"
        >
          <p className="truncate border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {title}
          </p>
          {header}
          <ul>{buttons}</ul>
        </div>
      ) : (
        <ul
          ref={menuRef as React.RefObject<HTMLUListElement>}
          role="menu"
          aria-label={`Options for ${title}`}
          style={{ left, top, width: MENU_WIDTH }}
          className="absolute overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-600 dark:bg-slate-800"
        >
          {header}
          {buttons}
        </ul>
      )}
    </div>
  );
}
