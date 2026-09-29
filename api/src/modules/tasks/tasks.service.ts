import mongoose from "mongoose";
import { Task } from "../../models/Task.js";
import { TaskActivity } from "../../models/TaskActivity.js";
import { Notification } from "../../models/Notification.js";
import { Project } from "../../models/Project.js";
import { Membership } from "../../models/Membership.js";
import { Organization } from "../../models/Organization.js";
import { requireTenantId, getTenantContext } from "../../tenancy/context.js";
import { AppError } from "../../lib/errors.js";
import { can } from "../../auth/rbac.js";
import {
  canUpdateTask,
  isTaskAssignee,
  type TaskOwnershipFields,
} from "../../auth/ownership.js";
import { FREE_PLAN_ACTIVE_TASK_LIMIT } from "../../constants/plans.js";
import { recordAudit } from "../audit/audit.service.js";
import type { Role } from "../../constants/roles.js";
import type {
  CreateTaskInput,
  UpdateTaskInput,
  ListTasksQuery,
} from "./tasks.schemas.js";

async function validateAssignees(
  tenantId: string,
  assigneeIds: string[],
): Promise<void> {
  const count = await Membership.countDocuments({
    tenantId,
    userId: { $in: assigneeIds },
  });
  if (count !== new Set(assigneeIds).size) {
    throw new AppError(
      400,
      "INVALID_ASSIGNEE",
      "One or more assignees are not members of this organization",
    );
  }
}

async function getAdminAndManagerIds(): Promise<mongoose.Types.ObjectId[]> {
  const memberships = await Membership.find({
    role: { $in: ["admin", "manager"] },
  })
    .select("userId")
    .lean();
  return memberships.map((m) => m.userId);
}

// Members may only see tasks assigned to them, or tasks that aren't assigned
// to anyone above them (an admin or a manager).
export async function memberVisibilityFilter(userId: string) {
  const higherRoleIds = await getAdminAndManagerIds();
  return {
    $or: [
      { assigneeIds: new mongoose.Types.ObjectId(userId) },
      { assigneeIds: { $not: { $elemMatch: { $in: higherRoleIds } } } },
    ],
  };
}

export async function assertTaskVisible(
  task: TaskOwnershipFields,
): Promise<void> {
  const context = getTenantContext()!;
  if (context.role !== "member") return;
  if (isTaskAssignee(task, context.userId)) return;

  const higherRoleIds = new Set(
    (await getAdminAndManagerIds()).map((id) => id.toString()),
  );
  const assignedAbove = (task.assigneeIds ?? []).some((id) =>
    higherRoleIds.has(id.toString()),
  );
  if (assignedAbove) {
    throw new AppError(404, "NOT_FOUND", "Task not found");
  }
}

async function getActiveTaskLimit(tenantId: string): Promise<number | null> {
  const org = await Organization.findById(tenantId).setOptions({
    skipTenant: true,
  });
  return org?.plan === "free" ? FREE_PLAN_ACTIVE_TASK_LIMIT : null;
}

function countActiveTasks(projectId: string) {
  return Task.countDocuments({ projectId, status: { $ne: "done" } });
}

export async function getTaskStats(projectId: string) {
  const context = getTenantContext()!;
  const tenantId = requireTenantId();
  const project = await Project.findById(projectId);
  if (!project) {
    throw new AppError(404, "NOT_FOUND", "Project not found");
  }

  const [activeCount, activeLimit, assignedTask] = await Promise.all([
    countActiveTasks(projectId),
    getActiveTaskLimit(tenantId),
    Task.exists({
      projectId,
      assigneeIds: new mongoose.Types.ObjectId(context.userId),
    }),
  ]);

  return { activeCount, activeLimit, assignedToMe: assignedTask !== null };
}

export async function createTask(
  projectId: string,
  input: CreateTaskInput,
  createdBy: string,
) {
  const context = getTenantContext()!;
  const tenantId = requireTenantId();
  const project = await Project.findById(projectId);

  if (!project) {
    throw new AppError(404, "NOT_FOUND", "Project not found");
  }

  if (project.archivedAt) {
    throw new AppError(
      400,
      "PROJECT_ARCHIVED",
      "Cannot create tasks in an archived project",
    );
  }

  const activeLimit = await getActiveTaskLimit(tenantId);
  if (activeLimit !== null) {
    const activeCount = await countActiveTasks(projectId);
    if (activeCount >= activeLimit) {
      throw new AppError(
        400,
        "TASK_LIMIT_REACHED",
        `Free plan projects are limited to ${activeLimit} active tasks. Mark tasks as done or upgrade to Pro.`,
      );
    }
  }

  // Members can't assign work to others; a task a member creates is theirs.
  let assigneeIds = [...new Set(input.assigneeIds ?? [])];
  if (!can(context.role as Role, "task:assign")) {
    const assignsSomeoneElse = assigneeIds.some((id) => id !== createdBy);
    if (assignsSomeoneElse) {
      throw new AppError(
        403,
        "FORBIDDEN",
        "You do not have permission to assign tasks to other people",
      );
    }
    assigneeIds = [createdBy];
  }

  if (assigneeIds.length > 0) {
    await validateAssignees(tenantId, assigneeIds);
  }

  const dbSession = await mongoose.startSession();

  try {
    let task;

    await dbSession.withTransaction(async () => {
      const [created] = await Task.create(
        [
          {
            projectId,
            title: input.title,
            description: input.description,
            priority: input.priority,
            assigneeIds,
            dueDate: input.dueDate,
            createdBy,
          },
        ],
        { session: dbSession },
      );

      await recordAudit(
        {
          action: "task.created",
          entityType: "Task",
          entityId: created._id,
          metadata: { title: input.title, projectId },
        },
        dbSession,
      );

      task = created;
    });

    return task!;
  } finally {
    await dbSession.endSession();
  }
}

export async function listTasks(projectId: string, query: ListTasksQuery) {
  const context = getTenantContext()!;
  const userId = context.userId;
  const limit = query.limit ?? 20;

  const filter: Record<string, unknown> = { projectId };

  if (query.status) filter.status = query.status;
  if (query.priority) filter.priority = query.priority;
  if (query.mine === "true") {
    filter.assigneeIds = new mongoose.Types.ObjectId(userId);
  } else if (query.assigneeId) {
    filter.assigneeIds = new mongoose.Types.ObjectId(query.assigneeId);
  }

  if (context.role === "member") {
    filter.$and = [await memberVisibilityFilter(userId)];
  }

  if (query.cursor) {
    filter._id = { $lt: query.cursor };
  }

  const tasks = await Task.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = tasks.length > limit;
  const items = hasMore ? tasks.slice(0, limit) : tasks;
  const nextCursor = hasMore ? String(items[items.length - 1]?._id) : null;

  return { items, nextCursor };
}

export async function getTask(taskId: string) {
  const task = await Task.findById(taskId);

  if (!task) {
    throw new AppError(404, "NOT_FOUND", "Task not found");
  }

  await assertTaskVisible(task);

  return task;
}

function comparableValue(field: string, value: unknown): unknown {
  if (field === "dueDate") {
    return value instanceof Date ? value.getTime() : value;
  }
  if (field === "assigneeIds") {
    return Array.isArray(value)
      ? value
          .map((id) => String(id))
          .sort()
          .join(",")
      : "";
  }
  return value;
}

export async function updateTask(taskId: string, input: UpdateTaskInput) {
  const context = getTenantContext()!;
  const tenantId = requireTenantId();
  const task = await Task.findById(taskId);

  if (!task) {
    throw new AppError(404, "NOT_FOUND", "Task not found");
  }

  await assertTaskVisible(task);

  const isReassigning = Object.prototype.hasOwnProperty.call(
    input,
    "assigneeIds",
  );

  if (isReassigning && !can(context.role as Role, "task:assign")) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "You do not have permission to reassign tasks",
    );
  }

  const allowed = canUpdateTask(
    { userId: context.userId, role: context.role as Role },
    task,
    input,
  );

  if (!allowed) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "You can only edit tasks that are assigned to you",
    );
  }

  const changes = { ...input };
  if (isReassigning) {
    changes.assigneeIds = [...new Set(input.assigneeIds ?? [])];
    if (changes.assigneeIds.length > 0) {
      await validateAssignees(tenantId, changes.assigneeIds);
    }
  }

  const dbSession = await mongoose.startSession();

  try {
    await dbSession.withTransaction(async () => {
      const diff: Record<string, { from: unknown; to: unknown }> = {};
      const trackedFields = [
        "title",
        "description",
        "status",
        "priority",
        "assigneeIds",
        "dueDate",
      ] as const;

      for (const field of trackedFields) {
        if (!Object.prototype.hasOwnProperty.call(changes, field)) continue;

        const oldValue = (task as unknown as Record<string, unknown>)[field];
        const newValue = changes[field];

        if (
          comparableValue(field, oldValue) !== comparableValue(field, newValue)
        ) {
          diff[field] = { from: oldValue, to: newValue };
        }
      }

      Object.assign(task, changes);
      await task.save({ session: dbSession });

      await recordAudit(
        {
          action: "task.updated",
          entityType: "Task",
          entityId: taskId,
          metadata: diff,
        },
        dbSession,
      );
    });

    return task;
  } finally {
    await dbSession.endSession();
  }
}

export async function deleteTask(taskId: string) {
  const context = getTenantContext()!;
  const task = await Task.findById(taskId);

  if (!task) {
    throw new AppError(404, "NOT_FOUND", "Task not found");
  }

  if (!can(context.role as Role, "task:delete")) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "You do not have permission to delete this task",
    );
  }

  const dbSession = await mongoose.startSession();

  try {
    await dbSession.withTransaction(async () => {
      await Task.deleteOne({ _id: taskId }).session(dbSession);
      await TaskActivity.deleteMany({ taskId }).session(dbSession);
      await Notification.deleteMany({
        tenantId: requireTenantId(),
        taskId,
      }).session(dbSession);

      await recordAudit(
        {
          action: "task.deleted",
          entityType: "Task",
          entityId: taskId,
          metadata: { title: task.title },
        },
        dbSession,
      );
    });
  } finally {
    await dbSession.endSession();
  }
}
