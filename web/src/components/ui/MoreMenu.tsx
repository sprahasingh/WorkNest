import { useState } from "react";
import { cn } from "@/lib/cn";

interface MoreMenuProps {
  label: string;
  children: React.ReactNode;
  className?: string;
}

export function MoreMenu({ label, children, className }: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className={cn("relative", className)}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        aria-label={`${label} actions`}
        className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-500 dark:text-slate-300 dark:hover:bg-slate-700 [&::-webkit-details-marker]:hidden"
      >
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
      </summary>
      {open && (
        <>
          <button
            className="fixed inset-0 z-20 cursor-default"
            aria-label="Close actions"
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute right-0 z-30 mt-1 min-w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
            onClick={() => setOpen(false)}
          >
            {children}
          </div>
        </>
      )}
    </details>
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
