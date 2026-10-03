import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";

export interface ViewTab<T extends string> {
  value: T;
  label: string;
  // Left out while the count is still loading.
  count?: number;
}

interface ViewTabsProps<T extends string> {
  label: string;
  tabs: ViewTab<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

// The Active / Completed / Archived / Bin switcher used on the projects page
// and on each project's board. On phones it spans the width with each count
// under its label, so all four fit with readable text and 44px tap targets.
// Each tab is as wide as its word plus an equal share of the spare room, so a
// short label like "Bin" doesn't sit in a big empty box. On larger screens
// the count sits beside the label.
export function ViewTabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  className,
}: ViewTabsProps<T>) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Arrow keys move between tabs, as screen reader users expect of a tab list.
  const handleKeyDown = (event: KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    buttonRefs.current[next]?.focus();
    onChange(tabs[next].value);
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        "flex w-full gap-1 overflow-x-auto rounded-lg bg-slate-200 p-1 sm:inline-flex sm:w-auto dark:bg-slate-800",
        className,
      )}
    >
      {tabs.map((tab, index) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(element) => {
              buttonRefs.current[index] = element;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "flex min-h-11 min-w-0 flex-auto flex-col items-center justify-center gap-1 whitespace-nowrap rounded-md px-1 py-1 text-[13px] font-medium leading-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 sm:h-9 sm:min-h-0 sm:flex-none sm:flex-row sm:gap-1.5 sm:px-3 sm:py-0 sm:text-sm",
              selected
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-50"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100",
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums",
                  selected
                    ? "bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-200"
                    : "bg-white/60 text-slate-600 dark:bg-slate-700/70 dark:text-slate-300",
                )}
              >
                {tab.count > 999 ? "999+" : tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
