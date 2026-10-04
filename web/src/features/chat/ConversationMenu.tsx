import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import type { ConversationAction, MenuItem } from "./conversationMenuItems";

interface ConversationMenuProps {
  title: string;
  items: MenuItem[];
  // Where the press happened; null closes the menu.
  anchor: { x: number; y: number; touch: boolean } | null;
  onSelect: (action: ConversationAction) => void;
  onClose: () => void;
}

const MENU_WIDTH = 208;

// Opens from a long press, a right click or the "more" button. On a phone it
// slides up from the bottom; with a mouse it sits at the pointer.
export function ConversationMenu({
  title,
  items,
  anchor,
  onSelect,
  onClose,
}: ConversationMenuProps) {
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!anchor) return;
    const previous = document.activeElement as HTMLElement | null;
    firstRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [anchor, onClose]);

  if (!anchor) return null;

  const left = Math.max(
    8,
    Math.min(anchor.x, window.innerWidth - MENU_WIDTH - 8),
  );
  const top = Math.max(
    8,
    Math.min(anchor.y, window.innerHeight - items.length * 40 - 24),
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
        onClick={onClose}
      />
      {anchor.touch ? (
        <div
          role="menu"
          aria-label={`Options for ${title}`}
          className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-slate-200 bg-white pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl animate-[sheet-up_200ms_ease-out] motion-reduce:animate-none dark:border-slate-700 dark:bg-slate-800"
        >
          <p className="truncate border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {title}
          </p>
          <ul>{buttons}</ul>
        </div>
      ) : (
        <ul
          role="menu"
          aria-label={`Options for ${title}`}
          style={{ left, top, width: MENU_WIDTH }}
          className="absolute overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-600 dark:bg-slate-800"
        >
          {buttons}
        </ul>
      )}
    </div>
  );
}
