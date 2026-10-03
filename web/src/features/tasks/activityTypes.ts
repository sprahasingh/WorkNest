import type { ActivityType, TaskNotificationType } from "./api";
import type {
  MeetingNotificationType,
  ProjectNotificationType,
} from "@/features/notifications/api";

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

export const TASK_NOTIFICATION_BADGE_STYLES: Record<
  TaskNotificationType,
  string
> = {
  task_assigned: "bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  task_completed:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  task_due_soon:
    "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  task_overdue: "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300",
};

export const PROJECT_NOTIFICATION_BADGE_STYLES: Record<
  ProjectNotificationType,
  string
> = {
  project_due_soon:
    "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  project_overdue:
    "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300",
};

export const MEETING_NOTIFICATION_BADGE_STYLES: Record<
  MeetingNotificationType,
  string
> = {
  meeting_invited:
    "bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  meeting_updated:
    "bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  meeting_cancelled:
    "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  meeting_response:
    "bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  meeting_starting:
    "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  meeting_proposal:
    "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
};
