// Shared by the dashboard's charts.

import type { ProjectProgress } from "./api";

export function taskCountFormatter(value: unknown): [string, string] {
  return [String(value), "Tasks"];
}

export type StatusKey = "todo" | "in_progress" | "done";
export const STATUS_KEYS: StatusKey[] = ["todo", "in_progress", "done"];
export const STATUS_LABELS: Record<StatusKey, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

// Checked for colorblind separation against each mode's card background;
// dark mode uses its own steps of the same hues.
const STATUS_COLORS: Record<"light" | "dark", Record<StatusKey, string>> = {
  light: { todo: "#2a78d6", in_progress: "#eda100", done: "#1baf7a" },
  dark: { todo: "#3987e5", in_progress: "#c98500", done: "#199e70" },
};

// Tasks created. Checked for colorblind separation against the done green
// in each mode.
export const CREATED_COLOR = { light: "#4a3aa7", dark: "#9085e9" };

export function statusColors(isDark: boolean): Record<StatusKey, string> {
  return STATUS_COLORS[isDark ? "dark" : "light"];
}

export type Stage = "notStarted" | "inProgress" | "completed";
export const STAGES: { key: Stage; label: string }[] = [
  { key: "notStarted", label: "Not started" },
  { key: "inProgress", label: "In progress" },
  { key: "completed", label: "Completed" },
];

// Not started: nothing in progress or done yet. Completed: has tasks and all
// of them are done. Everything else is in progress.
export function projectStage(project: ProjectProgress): Stage {
  if (project.total > 0 && project.done === project.total) return "completed";
  if (project.done === 0 && project.inProgress === 0) return "notStarted";
  return "inProgress";
}
