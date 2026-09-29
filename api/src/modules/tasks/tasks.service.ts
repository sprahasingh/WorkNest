import mongoose from "mongoose";
import { Task } from "../../models/Task.js";
import { Project } from "../../models/Project.js";
import { Membership } from "../../models/Membership.js";
import { Organization } from "../../models/Organization.js";
import { requireTenantId, getTenantContext } from "../../tenancy/context.js";
import { AppError } from "../../lib/errors.js";
import { can } from "../../auth/rbac.js";
import { canUpdateTask } from "../../auth/ownership.js";
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
  for (const id of assigneeIds) {
    const membership = await Membership.findOne({ tenantId, userId: id });
    if (!membership) {
      throw new AppError(
        400,
        "INVALID_ASSIGNEE",
        "One or more assignees are not members of this organization",
      );
    }
  }
}

export async function createTask(
  projectId: string,
  input: CreateTaskInput,
  createdBy: string,
) {
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

  const org = await Organization.findById(tenantId).setOptions({
    skipTenant: true,
  });
  if (org?.plan === "free") {
    const activeCount = await Task.countDocuments({
      projectId,
      status: { $ne: "done" },
    });
    if (activeCount >= 10) {
      throw new AppError(
        400,
        "TASK_LIMIT_REACHED",
        "Free plan projects are limited to 10 active tasks. Mark tasks as done or upgrade to Pro.",
      );
    }
  }

  if (input.assigneeIds?.length) {
    await validateAssignees(tenantId, input.assigneeIds);
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
            assigneeIds: input.assigneeIds ?? [],
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
    const higherRoleMembers = await Membership.find({
      role: { $in: ["admin", "manager"] },
    })
      .select("userId")
      .lean();
    const higherRoleIds = higherRoleMembers.map((m) => m.userId);

    const visibilityFilter = {
      $or: [
        { assigneeIds: new mongoose.Types.ObjectId(userId) },
        { assigneeIds: { $not: { $elemMatch: { $in: higherRoleIds } } } },
      ],
    };

    filter.$and = [visibilityFilter];
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
    task as unknown as Parameters<typeof canUpdateTask>[1],
    input,
  );

  if (!allowed) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "You do not have permission to update this task",
    );
  }

  if (input.assigneeIds?.length) {
    await validateAssignees(tenantId, input.assigneeIds);
  }

  const dbSession = await mongoose.startSession();

  try {
    await dbSession.withTransaction(async () => {
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const trackedFields = [
        "title",
        "description",
        "status",
        "priority",
        "assigneeIds",
        "dueDate",
      ] as const;

      for (const field of trackedFields) {
        if (!Object.prototype.hasOwnProperty.call(input, field)) continue;

        const oldValue = (task as unknown as Record<string, unknown>)[field];
        const newValue = input[field];

        if (
          comparableValue(field, oldValue) !== comparableValue(field, newValue)
        ) {
          changes[field] = { from: oldValue, to: newValue };
        }
      }

      Object.assign(task, input);
      await task.save({ session: dbSession });

      await recordAudit(
        {
          action: "task.updated",
          entityType: "Task",
          entityId: taskId,
          metadata: changes,
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
