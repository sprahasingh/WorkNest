import { useEffect, useRef, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import {
  desktopAlertsAvailable,
  playChime,
  readAlertPrefs,
  writeAlertPrefs,
  type ChatAlertPrefs,
} from "./chatPrefs";

function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start justify-between gap-3 rounded-lg px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/50",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
          {label}
        </span>
        <span className="block text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </span>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-teal-600"
      />
    </label>
  );
}

// Optional extras for new messages. Both start off.
export function AlertSettings() {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<ChatAlertPrefs>(readAlertPrefs);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Where the panel starts on a phone, just under the bell.
  const [panelTop, setPanelTop] = useState(0);
  const available = desktopAlertsAvailable();

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const update = (next: ChatAlertPrefs) => {
    setPrefs(next);
    writeAlertPrefs(next);
  };

  const setDesktop = async (value: boolean) => {
    if (!value) return update({ ...prefs, desktop: false });
    const result =
      Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
    if (result !== "granted") {
      toast.error("Desktop alerts are blocked in this browser.", {
        description:
          "Allow notifications for this site in your browser settings.",
      });
      return;
    }
    update({ ...prefs, desktop: true });
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          const rect = buttonRef.current?.getBoundingClientRect();
          if (rect) setPanelTop(rect.bottom + 4);
          setOpen((value) => !value);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Message alerts"
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 dark:text-slate-400 dark:hover:bg-slate-800",
          (prefs.desktop || prefs.sound) && "text-teal-700 dark:text-teal-400",
        )}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-[18px] w-[18px]"
          aria-hidden="true"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Message alerts"
          // On a phone the panel is pinned to the screen with a margin on
          // both sides, so it can never run off the edge. From the sm
          // breakpoint it hangs under the bell as a small popover.
          style={{ "--panel-top": `${panelTop}px` } as CSSProperties}
          className="fixed inset-x-3 top-(--panel-top) z-30 rounded-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-1 sm:w-72 border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-600 dark:bg-slate-800"
        >
          <p className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            When a message arrives
          </p>
          <Switch
            label="Desktop notifications"
            hint={
              available
                ? "Shown when this tab isn't in front."
                : "Not supported in this browser."
            }
            checked={prefs.desktop}
            disabled={!available}
            onChange={(value) => void setDesktop(value)}
          />
          <Switch
            label="Play a soft sound"
            hint="A short chime for new messages."
            checked={prefs.sound}
            onChange={(value) => {
              update({ ...prefs, sound: value });
              if (value) playChime();
            }}
          />
          <p className="px-2 pb-1 pt-2 text-xs text-slate-400">
            The tab title and icon always show your unread count. Muted chats
            stay quiet unless someone mentions you.
          </p>
        </div>
      )}
    </div>
  );
}
