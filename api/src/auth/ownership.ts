import type { Role } from "../constants/roles.js";
import { can } from "./rbac.js";

export interface OwnershipContext {
  userId: string;
  role: Role;
}

export interface TaskOwnershipFields {
  assigneeIds?: Array<{ toString(): string }> | null;
}

export interface TaskUpdateChanges {
  assigneeIds?: unknown;
}

export function isTaskAssignee(
  task: TaskOwnershipFields,
  userId: string,
): boolean {
  return task.assigneeIds?.some((id) => id.toString() === userId) ?? false;
}

// Admins and managers can edit any task; members only the tasks they are
// assigned to, and never the assignee list itself.
export function canUpdateTask(
  ctx: OwnershipContext,
  task: TaskOwnershipFields,
  changes: TaskUpdateChanges,
): boolean {
  if (can(ctx.role, "task:update:any")) {
    return true;
  }

  if (!can(ctx.role, "task:update:own")) {
    return false;
  }

  if (Object.prototype.hasOwnProperty.call(changes, "assigneeIds")) {
    return false;
  }

  return isTaskAssignee(task, ctx.userId);
}
