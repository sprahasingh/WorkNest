import type { Task } from "./api";

export function canChangeTaskStatus(
  task: Pick<Task, "assigneeIds">,
  currentUserId: string,
  canUpdateAny: boolean,
  canUpdateOwn: boolean,
): boolean {
  if (canUpdateAny) return true;
  if (!canUpdateOwn) return false;
  return task.assigneeIds?.includes(currentUserId) ?? false;
}
