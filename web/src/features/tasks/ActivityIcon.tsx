import { cn } from "@/lib/cn";
import type { ActivityType, TaskNotificationType } from "./api";
import {
  ACTIVITY_BADGE_STYLES,
  TASK_NOTIFICATION_BADGE_STYLES,
} from "./activityTypes";

const ICON_PATHS: Record<
  ActivityType | TaskNotificationType | "default",
  string[]
> = {
  update_request: ["M12 8v4l3 2", "M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9Z"],
  update: ["M20 6 9 17l-5-5"],
  question: [
    "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3",
    "M12 17h.01",
    "M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9Z",
  ],
  reply: ["M9 17 4 12l5-5", "M20 18v-2a4 4 0 0 0-4-4H4"],
  task_assigned: [
    "M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2",
    "M10 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
    "M20 8v6",
    "M23 11h-6",
  ],
  task_completed: ["M20 6 9 17l-5-5"],
  task_due_soon: ["M12 8v4l3 2", "M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9Z"],
  task_overdue: [
    "M12 9v4",
    "M12 17h.01",
    "M10.3 3.9 1.8 18.6A1.6 1.6 0 0 0 3.2 21h17.6a1.6 1.6 0 0 0 1.4-2.4L13.7 3.9a2 2 0 0 0-3.4 0Z",
  ],
  default: [
    "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9",
    "M13.73 21a2 2 0 0 1-3.46 0",
  ],
};

export function ActivityIcon({
  type,
  className,
}: {
  type: ActivityType | TaskNotificationType | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
        type
          ? type in ACTIVITY_BADGE_STYLES
            ? ACTIVITY_BADGE_STYLES[type as ActivityType]
            : TASK_NOTIFICATION_BADGE_STYLES[type as TaskNotificationType]
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
