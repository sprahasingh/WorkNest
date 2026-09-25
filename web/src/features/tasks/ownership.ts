import type { Task } from "./api";

/**
 * Mirrors the status-change subset of the backend's canUpdateTask
 * (api/src/auth/ownership.ts) — status changes never touch assigneeId, so
 * the "isReassigning" branch there is always false here and is omitted.
 * UI-only: the server re-checks this on every request regardless.
 */
export function canChangeTaskStatus(
  task: Pick<Task, "createdBy" | "assigneeId">,
  currentUserId: string,
  canUpdateAny: boolean,
  canUpdateOwn: boolean,
): boolean {
  if (canUpdateAny) return true;
  if (!canUpdateOwn) return false;
  return task.createdBy === currentUserId || task.assigneeId === currentUserId;
}
