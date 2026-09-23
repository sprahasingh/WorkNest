import mongoose from "mongoose";
import { Task } from "../../models/Task.js";
import { Project } from "../../models/Project.js";
import { Membership } from "../../models/Membership.js";
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

export async function createTask(
  projectId: string,
  input: CreateTaskInput,
  createdBy: string,
) {
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

  if (input.assigneeId) {
    const tenantId = requireTenantId();
    const membership = await Membership.findOne({
      tenantId,
      userId: input.assigneeId,
    });

    if (!membership) {
      throw new AppError(
        400,
        "INVALID_ASSIGNEE",
        "The assignee is not a member of this organization",
      );
    }
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
            assigneeId: input.assigneeId,
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
  const userId = getTenantContext()!.userId;
  const limit = query.limit ?? 20;

  const filter: Record<string, unknown> = { projectId };

  if (query.status) filter.status = query.status;
  if (query.priority) filter.priority = query.priority;
  if (query.mine === "true") {
    filter.assigneeId = userId;
  } else if (query.assigneeId) {
    filter.assigneeId = query.assigneeId;
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

export async function updateTask(taskId: string, input: UpdateTaskInput) {
  const context = getTenantContext()!;
  const task = await Task.findById(taskId);

  if (!task) {
    throw new AppError(404, "NOT_FOUND", "Task not found");
  }

  const isReassigning = Object.prototype.hasOwnProperty.call(
    input,
    "assigneeId",
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

  if (input.assigneeId) {
    const tenantId = requireTenantId();
    const membership = await Membership.findOne({
      tenantId,
      userId: input.assigneeId,
    });

    if (!membership) {
      throw new AppError(
        400,
        "INVALID_ASSIGNEE",
        "The assignee is not a member of this organization",
      );
    }
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
        "assigneeId",
        "dueDate",
      ] as const;

      for (const field of trackedFields) {
        if (
          Object.prototype.hasOwnProperty.call(input, field) &&
          input[field] !== (task as unknown as Record<string, unknown>)[field]
        ) {
          changes[field] = {
            from: (task as unknown as Record<string, unknown>)[field],
            to: input[field],
          };
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
