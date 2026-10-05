import { logger } from "../../lib/logger.js";
import mongoose from "mongoose";
import { dateOnlyDueDate } from "../../lib/timezone.js";
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
import { projectConsumesSlot, syncProjectSlot } from "../orgs/orgs.service.js";
import { recordAudit } from "../audit/audit.service.js";
import { creatorIfInvolved, mutedAmong } from "../notifications/audience.js";
import type { Role } from "../../constants/roles.js";
import {
  TASK_VIEWS,
  type CreateTaskInput,
  type UpdateTaskInput,
  type ListTasksQuery,
  type TaskView,
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

async function normalizeDueDate(
  value: Date | string | null | undefined,
  tenantId: string,
): Promise<Date | null | undefined> {
  if (typeof value !== "string") return value;
  const organization = await Organization.findById(tenantId)
    .select("timeZone")
    .setOptions({ skipTenant: true });
  const timeZone =
    typeof organization?.timeZone === "string" ? organization.timeZone : "UTC";
  return dateOnlyDueDate(value, timeZone);
}

async function getAdminAndManagerIds(): Promise<mongoose.Types.ObjectId[]> {
  const memberships = await Membership.find({
    role: { $in: ["admin", "manager"] },
  })
    .select("userId")
    .lean();
  return memberships.map((m) => m.userId);
}

async function notifyTaskAssignees(
  task: {
    _id: mongoose.Types.ObjectId;
    projectId: mongoose.Types.ObjectId;
    title: string;
    updatedAt?: Date;
  },
  assigneeIds: string[],
  actorId: string,
  tenantId: string,
  dbSession: mongoose.ClientSession,
): Promise<void> {
  const recipientIds = [...new Set(assigneeIds)].filter(
    (assigneeId) => assigneeId !== actorId,
  );
  if (recipientIds.length === 0) return;

  const actor = await User.findById(actorId)
    .select("name")
    .session(dbSession)
    .lean();
  const eventKey = `${task._id}:task_assigned:${task.updatedAt?.getTime() ?? Date.now()}`;
  await Notification.bulkWrite(
    recipientIds.map((assigneeId) => ({
      updateOne: {
        filter: { userId: new mongoose.Types.ObjectId(assigneeId), eventKey },
        update: {
          $setOnInsert: {
            userId: new mongoose.Types.ObjectId(assigneeId),
            tenantId: new mongoose.Types.ObjectId(tenantId),
            projectId: task.projectId,
            taskId: task._id,
            activityId: null,
            type: "task_assigned" as const,
            actorId: new mongoose.Types.ObjectId(actorId),
            message: `${actor?.name ?? "Someone"} assigned "${task.title}" to you`,
            eventKey,
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

function countActiveTasks(
  projectId: string,
  dbSession?: mongoose.ClientSession,
) {
  return Task.countDocuments({
    projectId,
    status: { $ne: "done" },
    archivedAt: null,
    deletedAt: null,
  }).session(dbSession ?? null);
}

// Creating a task or reopening a finished one adds an active task, so both
// must fit within the plan's per-project limit.
async function assertRoomForActiveTask(
  tenantId: string,
  projectId: string,
  action: "create" | "reopen" | "restore",
  // Inside a transaction that has locked the project (see
  // projectConsumesSlot), the count can't change under us.
  dbSession?: mongoose.ClientSession,
): Promise<void> {
  const plan = await getPlan(tenantId);
  const limit = PLAN_LIMITS[plan].activeTaskLimit;
  if (limit === null) return;

  const activeCount = await countActiveTasks(projectId, dbSession);
  if (activeCount < limit) return;

  const nextStep =
    action === "create"
      ? "Mark a task as done"
      : action === "restore"
        ? "Finish another task before restoring this one"
        : "Finish another task before reopening this one";
  throw new AppError(
    400,
    "TASK_LIMIT_REACHED",
    `${PLAN_NAMES[plan]} plan allows up to ${limit} active tasks per project. ${nextStep}, or upgrade your plan.`,
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

  const dueDate = await normalizeDueDate(input.dueDate, tenantId);

  const dbSession = await mongoose.startSession();

  try {
    let task;

    await dbSession.withTransaction(async () => {
      const wasActive = await projectConsumesSlot(projectId, dbSession);
      await assertRoomForActiveTask(tenantId, projectId, "create", dbSession);
      const [created] = await Task.create(
        [
          {
            projectId,
            title: input.title,
            description: input.description,
            priority: input.priority,
            assigneeIds,
            dueDate,
            dueDateIsDateOnly: typeof input.dueDate === "string",
            createdBy,
          },
        ],
        { session: dbSession },
      );
      await syncProjectSlot(tenantId, projectId, wasActive, dbSession);

      await notifyTaskAssignees(
        created,
        assigneeIds,
        context.userId,
        tenantId,
        dbSession,
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

const VIEW_FILTERS: Record<TaskView, Record<string, unknown>> = {
  active: { status: { $ne: "done" }, archivedAt: null, deletedAt: null },
  completed: { status: "done", archivedAt: null, deletedAt: null },
  archived: { archivedAt: { $ne: null }, deletedAt: null },
  bin: { deletedAt: { $ne: null } },
};

type TaskListFilters = Pick<ListTasksQuery, "priority" | "assigneeId" | "mine">;

// The board's filters and who can see what, shared by the lists and the tab
// counts so they can't disagree. Each view adds its own part on top.
async function buildTaskFilter(
  projectId: string,
  query: TaskListFilters,
): Promise<Record<string, unknown>> {
  const context = getTenantContext()!;
  const filter: Record<string, unknown> = { projectId };

  if (query.priority) filter.priority = query.priority;
  if (query.mine === "true") {
    filter.assigneeIds = new mongoose.Types.ObjectId(context.userId);
  } else if (query.assigneeId) {
    filter.assigneeIds = new mongoose.Types.ObjectId(query.assigneeId);
  }

  if (context.role === "member") {
    filter.$and = [await memberVisibilityFilter(context.userId)];
  }
  return filter;
}

// How many tasks each tab holds with the board's current filters applied.
export async function countTasksByView(
  projectId: string,
  query: TaskListFilters,
): Promise<Record<TaskView, number>> {
  if (!(await Project.exists({ _id: projectId }))) {
    throw new AppError(404, "NOT_FOUND", "Project not found");
  }

  const retentionCutoff = new Date(
    Date.now() - BIN_RETENTION_DAYS * 86_400_000,
  );
  const baseFilter = await buildTaskFilter(projectId, query);
  const [active, completed, archived, bin] = await Promise.all(
    TASK_VIEWS.map((view) =>
      Task.countDocuments({
        ...baseFilter,
        ...VIEW_FILTERS[view],
        // Binned tasks past their 30 days are due to be purged; skip them.
        ...(view === "bin" && { deletedAt: { $gte: retentionCutoff } }),
      }).setOptions({ includeDeleted: view === "bin" }),
    ),
  );
  return { active, completed, archived, bin };
}

export async function listTasks(projectId: string, query: ListTasksQuery) {
  const limit = query.limit ?? 20;

  if (!(await Project.exists({ _id: projectId }))) {
    throw new AppError(404, "NOT_FOUND", "Project not found");
  }

  const view: TaskView =
    query.view ?? (query.status === "done" ? "completed" : "active");
  if (view === "bin") {
    await purgeExpiredTasks(requireTenantId());
  }
  const filter: Record<string, unknown> = {
    ...(await buildTaskFilter(projectId, query)),
    ...VIEW_FILTERS[view],
  };
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

  const sortBy =
    query.sortBy ??
    (view === "active"
      ? "dueDate"
      : view === "completed"
        ? "completedAt"
        : view === "archived"
          ? "archivedAt"
          : "deletedAt");
  const priorityRanks = { high: 0, medium: 1, low: 2 } as const;
  const sortDirection =
    sortBy === "priority"
      ? query.sortOrder === "asc"
        ? -1
        : 1
      : query.sortOrder === "asc"
        ? 1
        : -1;
  const cursorMatch: Record<string, unknown> | null = query.cursor
    ? (() => {
        const cursorParts = query.cursor!.split("_");
        if (cursorParts.length === 1) {
          return { _id: { $lt: new mongoose.Types.ObjectId(query.cursor) } };
        }

        const [sortValue, cursorRankValue, cursorTaskId] =
          cursorParts.length === 3
            ? cursorParts
            : [cursorParts[0], "0", cursorParts[1]];
        const cursorRank = Number(cursorRankValue);
        const taskId = new mongoose.Types.ObjectId(cursorTaskId);
        const idComparison = sortDirection === 1 ? "$gt" : "$lt";

        if (sortBy === "priority") {
          const rankComparison = sortDirection === 1 ? "$gt" : "$lt";
          return {
            $or: [
              { _priorityRank: { [rankComparison]: Number(sortValue) } },
              {
                _priorityRank: Number(sortValue),
                _id: { [idComparison]: taskId },
              },
            ],
          };
        }

        if (sortValue === "null") {
          return {
            _sortMissing: 1,
            $or: [
              { _priorityRank: { $gt: cursorRank } },
              {
                _priorityRank: cursorRank,
                _id: { [idComparison]: taskId },
              },
            ],
          };
        }

        const cursorDate = new Date(Number(sortValue));
        const dateComparison = sortDirection === 1 ? "$gt" : "$lt";
        return {
          $or: [
            { _sortMissing: 0, [sortBy]: { [dateComparison]: cursorDate } },
            {
              _sortMissing: 0,
              [sortBy]: cursorDate,
              _priorityRank: { $gt: cursorRank },
            },
            {
              _sortMissing: 0,
              [sortBy]: cursorDate,
              _priorityRank: cursorRank,
              _id: { [idComparison]: taskId },
            },
            { _sortMissing: 1 },
          ],
        };
      })()
    : null;

  const tasks = await Task.aggregate([
    {
      $match: {
        ...filter,
        projectId: new mongoose.Types.ObjectId(projectId),
      },
    },
    {
      $addFields: {
        _priorityRank: {
          $switch: {
            branches: [
              { case: { $eq: ["$priority", "high"] }, then: 0 },
              { case: { $eq: ["$priority", "medium"] }, then: 1 },
            ],
            default: 2,
          },
        },
        _sortMissing: {
          $cond: [{ $eq: [{ $ifNull: [`$${sortBy}`, null] }, null] }, 1, 0],
        },
      },
    },
    ...(cursorMatch ? [{ $match: cursorMatch }] : []),
    {
      $sort:
        sortBy === "priority"
          ? { _priorityRank: sortDirection, _id: sortDirection }
          : {
              _sortMissing: 1,
              [sortBy]: sortDirection,
              _priorityRank: 1,
              _id: sortDirection,
            },
    },
    { $limit: limit + 1 },
    { $project: { _priorityRank: 0, _sortMissing: 0 } },
  ]);
  const hasMore = tasks.length > limit;
  const items = hasMore ? tasks.slice(0, limit) : tasks;
  const lastItem = items[items.length - 1] as
    | (Record<string, unknown> & {
        _id: mongoose.Types.ObjectId;
        priority: "high" | "medium" | "low";
      })
    | undefined;
  const lastValue = lastItem?.[sortBy];
  const cursorValue =
    sortBy === "priority"
      ? String(lastItem ? priorityRanks[lastItem.priority] : 0)
      : lastValue
        ? String(new Date(lastValue as Date).getTime())
        : "null";
  const nextCursor = hasMore
    ? `${cursorValue}_${lastItem ? priorityRanks[lastItem.priority] : 0}_${String(lastItem?._id)}`
    : null;
  const retentionMs = BIN_RETENTION_DAYS * 86_400_000;
  return {
    items: items.map((task) => {
      return {
        ...task,
        purgeAt: task.deletedAt
          ? new Date(task.deletedAt.getTime() + retentionMs).toISOString()
          : null,
      };
    }),
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

  const changes: UpdateTaskInput & { dueDateIsDateOnly?: boolean } = {
    ...input,
  };
  if (Object.prototype.hasOwnProperty.call(changes, "dueDate")) {
    if (typeof changes.dueDate === "string") {
      changes.dueDate = await normalizeDueDate(changes.dueDate, tenantId);
      changes.dueDateIsDateOnly = true;
    } else {
      changes.dueDateIsDateOnly = false;
    }
  }
  if (isReassigning) {
    changes.assigneeIds = [...new Set(input.assigneeIds ?? [])];
    if (changes.assigneeIds.length > 0) {
      await validateAssignees(tenantId, changes.assigneeIds);
    }
  }

  const statusBefore = task.status;
  const dbSession = await mongoose.startSession();

  try {
    await dbSession.withTransaction(async () => {
      // The transaction can run again after a transient error, and a failed
      // attempt has already changed this in-memory copy (and the reminder
      // count). Start every attempt from what is really stored, so the diff,
      // the audit entry and the counter are right the second time.
      const fresh = await Task.findById(task._id).session(dbSession).lean();
      if (!fresh) throw new AppError(404, "NOT_FOUND", "Task not found");
      if (fresh.status !== statusBefore) {
        throw new AppError(
          409,
          "TASK_CHANGED",
          "This task was just changed by someone else. Refresh and try again.",
        );
      }
      task.set(fresh);
      const wasActive = await projectConsumesSlot(task.projectId, dbSession);
      if (reopening) {
        await assertRoomForActiveTask(
          tenantId,
          String(task.projectId),
          "reopen",
          dbSession,
        );
      }
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
      if (reopening || diff.dueDate) {
        task.reminderCycle = (task.reminderCycle ?? 0) + 1;
      }
      await task.save({ session: dbSession });
      await syncProjectSlot(tenantId, task.projectId, wasActive, dbSession);

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
      }

      if (diff.assigneeIds) {
        const previousAssigneeIds = (
          (diff.assigneeIds.from as mongoose.Types.ObjectId[] | undefined) ?? []
        ).map((userId) => userId.toString());
        const currentAssigneeIds = new Set(
          (task.assigneeIds ?? []).map((userId) => userId.toString()),
        );
        const removedAssigneeIds = previousAssigneeIds.filter(
          (userId) => !currentAssigneeIds.has(userId),
        );

        if (removedAssigneeIds.length > 0) {
          const removedMemberships = await Membership.find({
            userId: { $in: removedAssigneeIds },
          })
            .select("userId role")
            .session(dbSession)
            .lean();
          const removedMemberIds = removedMemberships
            .filter((membership) => membership.role === "member")
            .map((membership) => membership.userId);
          const removedAdminIds = removedMemberships
            .filter((membership) => membership.role === "admin")
            .map((membership) => membership.userId);
          const removedManagerIds = removedMemberships
            .filter((membership) => membership.role === "manager")
            .map((membership) => membership.userId);
          const reminderFilter = {
            tenantId,
            taskId: task._id,
            dismissedAt: null,
          };
          if (removedMemberIds.length > 0) {
            await Notification.deleteMany({
              ...reminderFilter,
              userId: { $in: removedMemberIds },
              type: { $in: ["task_due_soon", "task_overdue"] },
            }).session(dbSession);
          }

          if (removedAdminIds.length > 0) {
            await Notification.deleteMany({
              ...reminderFilter,
              userId: { $in: removedAdminIds },
              type: "task_due_soon",
            }).session(dbSession);
          }

          if (removedManagerIds.length > 0) {
            await Notification.deleteMany({
              ...reminderFilter,
              userId: { $in: removedManagerIds },
              type: "task_due_soon",
              eventKey: /:24h$/,
            }).session(dbSession);
          }
        }

        const previousAssigneeIdSet = new Set(previousAssigneeIds);
        const addedAssigneeIds = (
          (diff.assigneeIds.to as mongoose.Types.ObjectId[] | undefined) ?? []
        )
          .map((userId) => userId.toString())
          .filter((userId) => !previousAssigneeIdSet.has(userId));
        if (addedAssigneeIds.length > 0) {
          await notifyTaskAssignees(
            task,
            addedAssigneeIds,
            context.userId,
            tenantId,
            dbSession,
          );
        }
      }

      if (completing && completionEventKey) {
        // The people involved hear about it: the other assignees, and
        // whoever created the task and its project. Other admins and
        // managers see it on the dashboard. Muting the task or project
        // silences it.
        const [actor, project] = await Promise.all([
          User.findById(context.userId)
            .select("name")
            .session(dbSession)
            .lean(),
          Project.findById(task.projectId)
            .select("createdBy")
            .session(dbSession)
            .lean(),
        ]);
        const involvedIds = [
          ...new Set(
            [
              ...(task.assigneeIds ?? []),
              ...(await creatorIfInvolved(task.createdBy, task)),
              ...(await creatorIfInvolved(project?.createdBy, task)),
            ].map((id) => id.toString()),
          ),
        ].filter((userId) => userId !== context.userId);
        const muted = await mutedAmong(
          involvedIds,
          task.projectId,
          task._id,
          dbSession,
        );
        const recipientIds = involvedIds.filter((id) => !muted.has(id));

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
        { _id: taskId, archivedAt: null },
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
      // An open task takes an active-task slot again, so it needs room.
      if (archivedTask.status !== "done") {
        await projectConsumesSlot(archivedTask.projectId, dbSession);
        await assertRoomForActiveTask(
          requireTenantId(),
          String(archivedTask.projectId),
          "restore",
          dbSession,
        );
      }
      task = await Task.findOneAndUpdate(
        { _id: taskId, archivedAt: { $ne: null }, deletedAt: null },
        {
          archivedAt: null,
          archivedReason: null,
          ...(archivedTask.status === "done" ? {} : { completedAt: null }),
        },
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
      const wasActive = await projectConsumesSlot(task.projectId, dbSession);
      binnedTask = await Task.findOneAndUpdate(
        { _id: taskId, deletedAt: null },
        { deletedAt: new Date(), deletedBy: context.userId },
        { new: true, session: dbSession },
      );
      if (!binnedTask) throw new AppError(404, "NOT_FOUND", "Task not found");
      await syncProjectSlot(
        requireTenantId(),
        task.projectId,
        wasActive,
        dbSession,
      );
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
      "restore",
    );
  }

  const dbSession = await mongoose.startSession();
  try {
    let task;
    await dbSession.withTransaction(async () => {
      const wasActive = await projectConsumesSlot(
        binnedTask.projectId,
        dbSession,
      );
      if (binnedTask.status !== "done" && !binnedTask.archivedAt) {
        await assertRoomForActiveTask(
          requireTenantId(),
          String(binnedTask.projectId),
          "restore",
          dbSession,
        );
      }
      task = await Task.findOneAndUpdate(
        { _id: taskId, deletedAt: { $ne: null } },
        { deletedAt: null, deletedBy: null },
        { new: true, session: dbSession },
      ).setOptions({ includeDeleted: true });
      if (!task) {
        throw new AppError(404, "NOT_FOUND", "Task not found in the bin");
      }
      await syncProjectSlot(
        requireTenantId(),
        task.projectId,
        wasActive,
        dbSession,
      );
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
  })
    .limit(500)
    .setOptions({ includeDeleted: true, skipTenant: true });

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
    } catch (err) {
      // One that can't be removed must not stop the others being cleaned up.
      logger.error(
        { err, id: String(task._id) },
        "Could not purge an expired task",
      );
    } finally {
      await dbSession.endSession();
    }
  }
  return expired.length;
}

export async function deleteTask(taskId: string) {
  return moveTaskToBin(taskId);
}
