import type { ActivityType } from "./api";

// One vocabulary for task/project updates, shared by the activity feeds and
// the notifications panel so the same event always looks the same.
export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  update_request: "Update requested",
  update: "Update",
  question: "Question",
  reply: "Reply",
};

export const ACTIVITY_BADGE_STYLES: Record<ActivityType, string> = {
  update_request:
    "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  update: "bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  question:
    "bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  reply: "bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
};
