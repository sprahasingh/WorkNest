import type { Role } from "../constants/roles.js";
import { can } from "./rbac.js";

export interface OwnershipContext {
  userId: string;
  role: Role;
}

export interface TaskOwnershipFields {
  createdBy: { toString(): string };
  assigneeIds: Array<{ toString(): string }> | null | undefined;
}

export interface TaskUpdateChanges {
  assigneeIds?: unknown;
}

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

  const isReassigning = Object.prototype.hasOwnProperty.call(
    changes,
    "assigneeIds",
  );

  if (isReassigning) {
    return false;
  }

  const isCreator = task.createdBy.toString() === ctx.userId;
  const isAssignee =
    task.assigneeIds?.some((id) => id.toString() === ctx.userId) ?? false;

  return isCreator || isAssignee;
}
