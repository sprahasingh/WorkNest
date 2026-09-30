import mongoose from "mongoose";
import { Task } from "../../models/Task.js";
import { TaskActivity } from "../../models/TaskActivity.js";
import { Notification } from "../../models/Notification.js";
import { BIN_RETENTION_DAYS, Project } from "../../models/Project.js";
import { Membership } from "../../models/Membership.js";
import { Organization } from "../../models/Organization.js";
import { User } from "../../models/User.js";
import { requireTenantId, getTenantContext } from "../../tenancy/context.js";
import { AppError } from "../../lib/errors.js";
import { can } from "../../auth/rbac.js";
import {
  canUpdateTask,
  isTaskAssignee,
  type TaskOwnershipFields,
} from "../../auth/ownership.js";
import { PLAN_LIMITS, PLAN_NAMES, type Plan } from "../../constants/plans.js";
import { recordAudit } from "../audit/audit.service.js";
import type { Role } from "../../constants/roles.js";
import type {
  CreateTaskInput,
  UpdateTaskInput,
  ListTasksQuery,
  TaskView,
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
// A task is reachable only while its project isn't in the bin.
export async function findTaskInLiveProject(taskId: string) {
  const task = await Task.findById(taskId);
  if (!task) return null;
  const projectLive = await Project.exists({ _id: task.projectId });
  return projectLive ? task : null;
}

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

async function getPlan(tenantId: string): Promise<Plan> {
  const org = await Organization.findById(tenantId).setOptions({
    skipTenant: true,
  });
  return (org?.plan as Plan | undefined) ?? "free";
}

function countActiveTasks(projectId: string) {
  return Task.countDocuments({
    projectId,
    status: { $ne: "done" },
    archivedAt: null,
    deletedAt: null,
  });
}

// Creating a task or reopening a finished one adds an active task, so both
// must fit within the plan's per-project limit.
async function assertRoomForActiveTask(
  tenantId: string,
  projectId: string,
  action: "create" | "reopen",
): Promise<void> {
  const plan = await getPlan(tenantId);
  const limit = PLAN_LIMITS[plan].activeTaskLimit;
  if (limit === null) return;

  const activeCount = await countActiveTasks(projectId);
  if (activeCount < limit) return;

  const nextStep =
    action === "create"
      ? "Mark a task as done"
      : "Finish another task before reopening this one";
  throw new AppError(
    400,
    "TASK_LIMIT_REACHED",
    `${PLAN_NAMES[plan]} plan projects are limited to ${limit} active tasks. ${nextStep}, or upgrade your plan.`,
  );
}

export async function getTaskStats(projectId: string) {
  const context = getTenantContext()!;
  const tenantId = requireTenantId();
  const project = await Project.findById(projectId);
  if (!project) {
    throw new AppError(404, "NOT_FOUND", "Project not found");
  }

  const [activeCount, plan, assignedTask] = await Promise.all([
    countActiveTasks(projectId),
    getPlan(tenantId),
    Task.exists({
      projectId,
      assigneeIds: new mongoose.Types.ObjectId(context.userId),
    }),
  ]);

  return {
    activeCount,
    activeLimit: PLAN_LIMITS[plan].activeTaskLimit,
    plan,
    assignedToMe: assignedTask !== null,
  };
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

  await assertRoomForActiveTask(tenantId, projectId, "create");

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

  if (!(await Project.exists({ _id: projectId }))) {
    throw new AppError(404, "NOT_FOUND", "Project not found");
  }

  const view: TaskView =
    query.view ?? (query.status === "done" ? "completed" : "active");
  if (view === "bin") {
    await purgeExpiredTasks(requireTenantId());
  }
  const viewFilters: Record<TaskView, Record<string, unknown>> = {
    active: { status: { $ne: "done" }, archivedAt: null, deletedAt: null },
    completed: { status: "done", archivedAt: null, deletedAt: null },
    archived: { archivedAt: { $ne: null }, deletedAt: null },
    bin: { deletedAt: { $ne: null } },
  };
  const filter: Record<string, unknown> = {
    projectId,
    ...viewFilters[view],
  };

  if (query.priority) filter.priority = query.priority;
  if (query.mine === "true") {
    filter.assigneeIds = new mongoose.Types.ObjectId(userId);
  } else if (query.assigneeId) {
    filter.assigneeIds = new mongoose.Types.ObjectId(query.assigneeId);
  }

  if (context.role === "member") {
    filter.$and = [await memberVisibilityFilter(userId)];
  }
  if (query.status) {
    const existingAnd = Array.isArray(filter.$and)
      ? (filter.$and as Record<string, unknown>[])
      : [];
    filter.$and = [...existingAnd, { status: query.status }];
  }

  // Total for the whole list (every page), so a column can show its real size
  // rather than just the cards loaded so far.
  const total = await Task.countDocuments(filter).setOptions({
    includeDeleted: view === "bin",
  });

  const timestampField =
    view === "completed"
      ? "completedAt"
      : view === "archived"
        ? "archivedAt"
        : view === "bin"
          ? "deletedAt"
          : null;
  if (query.cursor) {
    if (timestampField && query.cursor.includes("_")) {
      const [timestamp, taskId] = query.cursor.split("_");
      const cursorDate = new Date(Number(timestamp));
      filter.$or = [
        { [timestampField]: { $lt: cursorDate } },
        { [timestampField]: cursorDate, _id: { $lt: taskId } },
      ];
    } else {
      filter._id = { $lt: query.cursor };
    }
  }

  const taskQuery = Task.find(filter).setOptions({
    includeDeleted: view === "bin",
  });
  const sortedTaskQuery = timestampField
    ? taskQuery.sort({ [timestampField]: -1, _id: -1 })
    : taskQuery.sort({ _id: -1 });
  const tasks = await sortedTaskQuery.limit(limit + 1).lean();

  const hasMore = tasks.length > limit;
  const items = hasMore ? tasks.slice(0, limit) : tasks;
  const lastItem = items[items.length - 1];
  const nextCursor = hasMore
    ? timestampField
      ? `${(lastItem as unknown as Record<string, Date | null>)[timestampField]?.getTime() ?? 0}_${String(lastItem?._id)}`
      : String(lastItem?._id)
    : null;

  const retentionMs = BIN_RETENTION_DAYS * 86_400_000;
  return {
    items: items.map((task) => ({
      ...task,
      purgeAt: task.deletedAt
        ? new Date(task.deletedAt.getTime() + retentionMs).toISOString()
        : null,
    })),
    nextCursor,
    total,
    binRetentionDays: BIN_RETENTION_DAYS,
  };
}

export async function getTask(taskId: string) {
  const task = await findTaskInLiveProject(taskId);

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
  const task = await findTaskInLiveProject(taskId);

  if (!task) {
    throw new AppError(404, "NOT_FOUND", "Task not found");
  }

  await assertTaskVisible(task);

  if (task.archivedAt) {
    throw new AppError(
      409,
      "TASK_ARCHIVED_READ_ONLY",
      "Unarchive this task before changing it",
    );
  }

  const isReopeningCompletedTask =
    task.status === "done" &&
    (input.status === "todo" || input.status === "in_progress");
  if (task.status === "done") {
    const hasOtherChanges = Object.keys(input).some((key) => key !== "status");
    if (
      hasOtherChanges ||
      (input.status &&
        input.status !== task.status &&
        !isReopeningCompletedTask)
    ) {
      throw new AppError(
        409,
        "TASK_COMPLETED_READ_ONLY",
        "Reopen this task before editing it",
      );
    }
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

  const reopening =
    task.status === "done" && !!input.status && input.status !== "done";
  const completing = task.status !== "done" && input.status === "done";
  const completionEventKey = completing
    ? `${task._id}:task_completed:${task.updatedAt?.getTime() ?? Date.now()}`
    : null;
  if (reopening) {
    await assertRoomForActiveTask(tenantId, String(task.projectId), "reopen");
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
      if (completing) task.completedAt = new Date();
      if (reopening) task.completedAt = null;
      await task.save({ session: dbSession });

      if (completing) {
        await Notification.updateMany(
          {
            tenantId,
            taskId: task._id,
            type: { $in: ["task_due_soon", "task_overdue"] },
            dismissedAt: null,
          },
          { dismissedAt: new Date() },
          { session: dbSession },
        );
      }

      if (diff.dueDate) {
        await Notification.updateMany(
          {
            tenantId,
            taskId: task._id,
            type: { $in: ["task_due_soon", "task_overdue"] },
            dismissedAt: null,
          },
          { dismissedAt: new Date() },
          { session: dbSession },
        );
      } else if (diff.assigneeIds) {
        await Notification.updateMany(
          {
            tenantId,
            taskId: task._id,
            type: { $in: ["task_due_soon", "task_overdue"] },
            userId: { $nin: task.assigneeIds ?? [] },
            dismissedAt: null,
          },
          { dismissedAt: new Date() },
          { session: dbSession },
        );
      }

      if (completing && completionEventKey) {
        const [actor, leadIds] = await Promise.all([
          User.findById(context.userId)
            .select("name")
            .session(dbSession)
            .lean(),
          getAdminAndManagerIds(),
        ]);
        const recipientIds = [
          ...new Set([
            ...(task.assigneeIds ?? []).map((id) => id.toString()),
            ...leadIds.map((id) => id.toString()),
          ]),
        ].filter((userId) => userId !== context.userId);

        if (recipientIds.length > 0) {
          await Notification.bulkWrite(
            recipientIds.map((userId) => ({
              updateOne: {
                filter: {
                  userId: new mongoose.Types.ObjectId(userId),
                  eventKey: completionEventKey,
                },
                update: {
                  $setOnInsert: {
                    userId: new mongoose.Types.ObjectId(userId),
                    tenantId: new mongoose.Types.ObjectId(tenantId),
                    projectId: task.projectId,
                    taskId: task._id,
                    activityId: null,
                    type: "task_completed" as const,
                    actorId: new mongoose.Types.ObjectId(context.userId),
                    message: `${actor?.name ?? "Someone"} marked "${task.title}" as done`,
                    eventKey: completionEventKey,
                    readAt: null,
                    dismissedAt: null,
                  },
                },
                upsert: true,
              },
            })),
            { session: dbSession, ordered: true },
          );
        }
      }

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

function assertCanManageTask(role: Role): void {
  if (!can(role, "task:delete")) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "You do not have permission to manage this task",
    );
  }
}

export async function archiveTask(taskId: string) {
  const context = getTenantContext()!;
  assertCanManageTask(context.role as Role);
  const task = await findTaskInLiveProject(taskId);
  if (!task) throw new AppError(404, "NOT_FOUND", "Task not found");
  if (task.status !== "done") {
    throw new AppError(
      400,
      "TASK_NOT_COMPLETED",
      "Only completed tasks can be archived",
    );
  }
  if (task.archivedAt) {
    throw new AppError(
      409,
      "TASK_ALREADY_ARCHIVED",
      "Task is already archived",
    );
  }

  const dbSession = await mongoose.startSession();
  try {
    let archivedTask;
    await dbSession.withTransaction(async () => {
      archivedTask = await Task.findOneAndUpdate(
        { _id: taskId, status: "done", archivedAt: null },
        { archivedAt: new Date() },
        { new: true, session: dbSession },
      );
      if (!archivedTask) {
        throw new AppError(
          409,
          "TASK_ALREADY_ARCHIVED",
          "Task is already archived",
        );
      }
      await Notification.updateMany(
        {
          tenantId: requireTenantId(),
          taskId,
          type: { $in: ["task_due_soon", "task_overdue"] },
          dismissedAt: null,
        },
        { dismissedAt: new Date() },
        { session: dbSession },
      );
      await recordAudit(
        {
          action: "task.archived",
          entityType: "Task",
          entityId: taskId,
          metadata: { title: task.title },
        },
        dbSession,
      );
    });
    return archivedTask!;
  } finally {
    await dbSession.endSession();
  }
}

export async function unarchiveTask(taskId: string) {
  const context = getTenantContext()!;
  assertCanManageTask(context.role as Role);
  const archivedTask = await Task.findOne({
    _id: taskId,
    archivedAt: { $ne: null },
  });
  if (
    !archivedTask ||
    !(await Project.exists({ _id: archivedTask.projectId }))
  ) {
    throw new AppError(404, "NOT_FOUND", "Archived task not found");
  }
  const dbSession = await mongoose.startSession();
  try {
    let task;
    await dbSession.withTransaction(async () => {
      task = await Task.findOneAndUpdate(
        { _id: taskId, archivedAt: { $ne: null }, deletedAt: null },
        { archivedAt: null },
        { new: true, session: dbSession },
      );
      if (!task) {
        throw new AppError(404, "NOT_FOUND", "Archived task not found");
      }
      await recordAudit(
        {
          action: "task.unarchived",
          entityType: "Task",
          entityId: taskId,
          metadata: { title: task.title },
        },
        dbSession,
      );
    });
    return task!;
  } finally {
    await dbSession.endSession();
  }
}

export async function moveTaskToBin(taskId: string) {
  const context = getTenantContext()!;
  assertCanManageTask(context.role as Role);
  const task = await findTaskInLiveProject(taskId);
  if (!task) throw new AppError(404, "NOT_FOUND", "Task not found");

  const dbSession = await mongoose.startSession();
  try {
    let binnedTask;
    await dbSession.withTransaction(async () => {
      binnedTask = await Task.findOneAndUpdate(
        { _id: taskId, deletedAt: null },
        { deletedAt: new Date(), deletedBy: context.userId },
        { new: true, session: dbSession },
      );
      if (!binnedTask) throw new AppError(404, "NOT_FOUND", "Task not found");
      await recordAudit(
        {
          action: "task.binned",
          entityType: "Task",
          entityId: taskId,
          metadata: { title: task.title },
        },
        dbSession,
      );
    });
    return binnedTask!;
  } finally {
    await dbSession.endSession();
  }
}

export async function restoreTask(taskId: string) {
  const context = getTenantContext()!;
  assertCanManageTask(context.role as Role);
  const retentionCutoff = new Date(
    Date.now() - BIN_RETENTION_DAYS * 86_400_000,
  );
  const binnedTask = await Task.findOne({
    _id: taskId,
    deletedAt: { $gte: retentionCutoff },
  }).setOptions({ includeDeleted: true });
  if (!binnedTask) {
    throw new AppError(404, "NOT_FOUND", "Task not found in the bin");
  }
  if (!(await Project.exists({ _id: binnedTask.projectId }))) {
    throw new AppError(
      409,
      "PROJECT_IN_BIN",
      "Restore the project before restoring its task",
    );
  }

  if (binnedTask.status !== "done" && !binnedTask.archivedAt) {
    await assertRoomForActiveTask(
      requireTenantId(),
      String(binnedTask.projectId),
      "reopen",
    );
  }

  const dbSession = await mongoose.startSession();
  try {
    let task;
    await dbSession.withTransaction(async () => {
      task = await Task.findOneAndUpdate(
        { _id: taskId, deletedAt: { $ne: null } },
        { deletedAt: null, deletedBy: null },
        { new: true, session: dbSession },
      ).setOptions({ includeDeleted: true });
      if (!task) {
        throw new AppError(404, "NOT_FOUND", "Task not found in the bin");
      }
      await recordAudit(
        {
          action: "task.restored",
          entityType: "Task",
          entityId: taskId,
          metadata: { title: task.title },
        },
        dbSession,
      );
    });
    return task!;
  } finally {
    await dbSession.endSession();
  }
}

async function destroyTask(
  task: {
    _id: mongoose.Types.ObjectId;
    tenantId: mongoose.Types.ObjectId;
  },
  dbSession: mongoose.ClientSession,
) {
  const taskId = task._id;
  await TaskActivity.deleteMany({ taskId })
    .session(dbSession)
    .setOptions({ skipTenant: true });
  await Notification.deleteMany({ tenantId: task.tenantId, taskId }).session(
    dbSession,
  );
  await Task.deleteOne({ _id: taskId })
    .session(dbSession)
    .setOptions({ skipTenant: true, includeDeleted: true });
}

export async function deleteTaskPermanently(taskId: string) {
  const context = getTenantContext()!;
  assertCanManageTask(context.role as Role);
  const dbSession = await mongoose.startSession();
  try {
    await dbSession.withTransaction(async () => {
      const task = await Task.findOne({
        _id: taskId,
        deletedAt: { $ne: null },
      })
        .session(dbSession)
        .setOptions({ includeDeleted: true });
      if (!task) {
        throw new AppError(
          404,
          "NOT_FOUND",
          "Only tasks in the bin can be deleted permanently",
        );
      }
      await destroyTask(task, dbSession);
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

export async function purgeExpiredTasks(tenantId?: string) {
  const cutoff = new Date(Date.now() - BIN_RETENTION_DAYS * 86_400_000);
  const expired = await Task.find({
    ...(tenantId ? { tenantId } : {}),
    deletedAt: { $lt: cutoff },
  }).setOptions({ includeDeleted: true, skipTenant: true });

  for (const task of expired) {
    const dbSession = await mongoose.startSession();
    try {
      await dbSession.withTransaction(async () => {
        await destroyTask(task, dbSession);
        await recordAudit(
          {
            action: "task.purged",
            entityType: "Task",
            entityId: task._id,
            metadata: { title: task.title },
            tenantId: task.tenantId,
            actorId: task.deletedBy ?? task.createdBy,
          },
          dbSession,
        );
      });
    } finally {
      await dbSession.endSession();
    }
  }
  return expired.length;
}

export async function deleteTask(taskId: string) {
  return moveTaskToBin(taskId);
}
