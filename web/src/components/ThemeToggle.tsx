import { useEffect, useRef, useState } from "react";
import { useTheme, type ThemePreference } from "@/theme/theme-context";
import { cn } from "@/lib/cn";

function SunIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
      <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
      <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  );
}

function SystemIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

const OPTIONS: {
  value: ThemePreference;
  label: string;
  icon: typeof SunIcon;
}[] = [
  { value: "system", label: "System", icon: SystemIcon },
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
];

export function ThemeToggle({
  menuPlacement = "down",
}: {
  menuPlacement?: "down" | "up";
}) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const ActiveIcon = resolvedTheme === "dark" ? MoonIcon : SunIcon;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Change theme"
        aria-expanded={open}
        className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        <ActiveIcon className="h-5 w-5" />
      </button>

      {open && (
        <div
          className={cn(
            "absolute right-0 z-30 w-36 rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800",
            menuPlacement === "up" ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setTheme(option.value);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-sm",
                theme === option.value
                  ? "text-teal-700 dark:text-teal-400"
                  : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700",
              )}
            >
              <option.icon className="h-4 w-4" />
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
