import { cn } from "@/lib/cn";
import type { ActivityType } from "./api";
import { ACTIVITY_BADGE_STYLES } from "./activityTypes";

const ICON_PATHS: Record<ActivityType | "default", string[]> = {
  update_request: ["M12 8v4l3 2", "M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9Z"],
  update: ["M20 6 9 17l-5-5"],
  question: [
    "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3",
    "M12 17h.01",
    "M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9Z",
  ],
  reply: ["M9 17 4 12l5-5", "M20 18v-2a4 4 0 0 0-4-4H4"],
  default: [
    "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9",
    "M13.73 21a2 2 0 0 1-3.46 0",
  ],
};

export function ActivityIcon({
  type,
  className,
}: {
  type: ActivityType | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
        type
          ? ACTIVITY_BADGE_STYLES[type]
          : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300",
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
      >
        {ICON_PATHS[type ?? "default"].map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </span>
  );
}
