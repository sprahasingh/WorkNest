import type { Task, TaskStatus } from "./api";

export function shouldPromptForAssignee(
  task: Pick<Task, "status" | "assigneeIds">,
  nextStatus: TaskStatus,
  canAssign: boolean,
): boolean {
  return (
    canAssign &&
    task.status === "todo" &&
    nextStatus === "in_progress" &&
    task.assigneeIds.length === 0
  );
}
