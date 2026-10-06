import { logger } from "../../lib/logger.js";
import mongoose from "mongoose";
import { BIN_RETENTION_DAYS, Project } from "../../models/Project.js";
import { Task } from "../../models/Task.js";
import { TaskActivity } from "../../models/TaskActivity.js";
import { Notification } from "../../models/Notification.js";
import { Organization } from "../../models/Organization.js";
import { getTenantContext, requireTenantId } from "../../tenancy/context.js";
import { AppError } from "../../lib/errors.js";
import { PLAN_LIMITS, PLAN_NAMES, type Plan } from "../../constants/plans.js";
import { dateOnlyDueDate } from "../../lib/timezone.js";
import {
  projectConsumesSlot,
  reserveProjectSlot,
  releaseProjectSlot,
  syncProjectSlot,
} from "../orgs/orgs.service.js";
import { recordAudit } from "../audit/audit.service.js";
import type {
  CreateProjectInput,
  UpdateProjectInput,
} from "./projects.schemas.js";

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

export async function createProject(
  input: CreateProjectInput,
  createdBy: string,
) {
  const tenantId = requireTenantId();
  const dueDate = await normalizeDueDate(input.dueDate, tenantId);
  const dbSession = await mongoose.startSession();

  try {
    let project;

    await dbSession.withTransaction(async () => {
      await reserveProjectSlot(tenantId, dbSession);

      const existing = await Project.findOne({ key: input.key })
        .session(dbSession)
        .setOptions({ includeDeleted: true });

      if (existing) {
        await releaseProjectSlot(tenantId, dbSession);
        throw new AppError(
          409,
          "CONFLICT",
          existing.deletedAt
            ? "A project in the bin uses this key. Restore it or delete it permanently first."
            : "A project with this key already exists",
        );
      }

      const [created] = await Project.create(
        [
          {
            tenantId,
            name: input.name,
            key: input.key,
            description: input.description,
            priority: input.priority,
            dueDate,
            dueDateIsDateOnly: typeof input.dueDate === "string",
            createdBy,
          },
        ],
        { session: dbSession },
      );

      await recordAudit(
        {
          action: "project.created",
          entityType: "Project",
          entityId: created._id,
          metadata: { name: input.name, key: input.key },
        },
        dbSession,
      );

      project = created;
    });

    return project!;
  } finally {
    await dbSession.endSession();
  }
}

export type ProjectView = "active" | "archived" | "bin";

const VIEW_FILTERS: Record<ProjectView, Record<string, unknown>> = {
  active: { archivedAt: null, deletedAt: null },
  archived: { archivedAt: { $ne: null }, deletedAt: null },
  bin: { deletedAt: { $ne: null } },
};

const DAY_MS = 86_400_000;

export async function listProjects(view: ProjectView) {
  // Clear out anything past its time in the bin before showing lists.
  await purgeExpiredProjects(requireTenantId());

  const [projects, activeProjects, archivedCount, binCount] = await Promise.all(
    [
      Project.find(VIEW_FILTERS[view]).sort(
        view === "bin" ? { deletedAt: -1 } : { createdAt: -1 },
      ),
      Project.find(VIEW_FILTERS.active).select("_id").lean(),
      Project.countDocuments(VIEW_FILTERS.archived),
      Project.countDocuments(VIEW_FILTERS.bin),
    ],
  );

  // Per-project task totals. Active means not done, the same count the
  // plan's per-project task limit is measured against.
  const taskCounts = await Task.aggregate<{
    _id: mongoose.Types.ObjectId;
    total: number;
    active: number;
    completed: number;
    completedAt: Date | null;
    todo: number;
    inProgress: number;
  }>([
    {
      $match: {
        projectId: {
          $in: [...activeProjects, ...projects].map((project) => project._id),
        },
        deletedAt: null,
      },
    },
    {
      $group: {
        _id: "$projectId",
        total: { $sum: 1 },
        active: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ["$status", "done"] },
                  { $eq: [{ $ifNull: ["$archivedAt", null] }, null] },
                ],
              },
              1,
              0,
            ],
          },
        },
        completed: {
          $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] },
        },
        completedAt: {
          $max: {
            $cond: [{ $eq: ["$status", "done"] }, "$completedAt", null],
          },
        },
        todo: {
          $sum: { $cond: [{ $eq: ["$status", "todo"] }, 1, 0] },
        },
        inProgress: {
          $sum: { $cond: [{ $eq: ["$status", "in_progress"] }, 1, 0] },
        },
      },
    },
  ]);
  const countsByProject = new Map(
    taskCounts.map((row) => [String(row._id), row]),
  );
  const activeCount = activeProjects.filter((project) => {
    const counts = countsByProject.get(String(project._id));
    return !counts || counts.total === 0 || counts.completed < counts.total;
  }).length;

  return {
    projects: projects.map((project) => {
      const counts = countsByProject.get(String(project._id));
      return {
        ...project.toJSON(),
        activeTaskCount: counts?.active ?? 0,
        completedTaskCount: counts?.completed ?? 0,
        completedAt: counts?.completedAt ?? null,
        todoTaskCount: counts?.todo ?? 0,
        inProgressTaskCount: counts?.inProgress ?? 0,
        taskCount: counts?.total ?? 0,
        // When a project in the bin will be deleted for good.
        purgeAt: project.deletedAt
          ? new Date(
              project.deletedAt.getTime() + BIN_RETENTION_DAYS * DAY_MS,
            ).toISOString()
          : null,
      };
    }),
    counts: { active: activeCount, archived: archivedCount, bin: binCount },
    binRetentionDays: BIN_RETENTION_DAYS,
  };
}

export async function getProject(projectId: string) {
  const project = await Project.findById(projectId);

  if (!project) {
    throw new AppError(404, "NOT_FOUND", "Project not found");
  }

  return project;
}

export async function updateProject(
  projectId: string,
  input: UpdateProjectInput,
) {
  const tenantId = requireTenantId();
  const changesToSave: UpdateProjectInput & { dueDateIsDateOnly?: boolean } = {
    ...input,
  };
  if (Object.prototype.hasOwnProperty.call(changesToSave, "dueDate")) {
    if (typeof changesToSave.dueDate === "string") {
      changesToSave.dueDate = await normalizeDueDate(
        changesToSave.dueDate,
        tenantId,
      );
      changesToSave.dueDateIsDateOnly = true;
    } else {
      changesToSave.dueDateIsDateOnly = false;
    }
  }
  const dbSession = await mongoose.startSession();

  try {
    let project;

    await dbSession.withTransaction(async () => {
      const before = await Project.findById(projectId).session(dbSession);

      if (!before) {
        throw new AppError(404, "NOT_FOUND", "Project not found");
      }

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (
        changesToSave.name !== undefined &&
        changesToSave.name !== before.name
      ) {
        changes.name = { from: before.name, to: changesToSave.name };
      }
      if (
        changesToSave.description !== undefined &&
        changesToSave.description !== before.description
      ) {
        changes.description = {
          from: before.description,
          to: changesToSave.description,
        };
      }

      if (Object.prototype.hasOwnProperty.call(changesToSave, "dueDate")) {
        const nextDueDate = changesToSave.dueDate;
        const previousDueDate = before.dueDate ?? null;
        const nextDate = nextDueDate ? new Date(nextDueDate) : null;
        if (previousDueDate?.getTime() !== nextDate?.getTime()) {
          changes.dueDate = { from: previousDueDate, to: nextDate };
        }
      }

      const updated = await Project.findByIdAndUpdate(
        projectId,
        changesToSave,
        {
          new: true,
          runValidators: true,
          session: dbSession,
        },
      );

      if (changes.dueDate) {
        updated!.reminderCycle = (updated!.reminderCycle ?? 0) + 1;
        await updated!.save({ session: dbSession });
        await Notification.updateMany(
          {
            tenantId,
            projectId: updated!._id,
            type: { $in: ["project_due_soon", "project_overdue"] },
            dismissedAt: null,
          },
          { dismissedAt: new Date() },
          { session: dbSession },
        );
      }

      await recordAudit(
        {
          action: "project.updated",
          entityType: "Project",
          entityId: projectId,
          metadata: changes,
        },
        dbSession,
      );

      project = updated;
    });

    return project!;
  } finally {
    await dbSession.endSession();
  }
}

export async function archiveProject(
  projectId: string,
  options: { reason?: "plan_limit" } = {},
) {
  const dbSession = await mongoose.startSession();

  try {
    let project;

    await dbSession.withTransaction(async () => {
      const before = await Project.findById(projectId).session(dbSession);
      if (!before) {
        throw new AppError(404, "NOT_FOUND", "Project not found");
      }
      const wasActive = await projectConsumesSlot(before._id, dbSession);
      const updated = await Project.findByIdAndUpdate(
        projectId,
        { archivedAt: new Date(), archivedReason: options.reason ?? null },
        { new: true, session: dbSession },
      );

      if (!updated) {
        throw new AppError(404, "NOT_FOUND", "Project not found");
      }
      await syncProjectSlot(
        String(updated.tenantId),
        updated._id,
        wasActive,
        dbSession,
      );

      await recordAudit(
        {
          action: "project.archived",
          entityType: "Project",
          entityId: projectId,
          metadata: options.reason ? { reason: options.reason } : {},
        },
        dbSession,
      );

      project = updated;
    });

    return project!;
  } finally {
    await dbSession.endSession();
  }
}

export async function unarchiveProject(projectId: string) {
  const dbSession = await mongoose.startSession();

  try {
    let project;

    await dbSession.withTransaction(async () => {
      const before = await Project.findOne({
        _id: projectId,
        archivedAt: { $ne: null },
      }).session(dbSession);
      if (!before) {
        throw new AppError(404, "NOT_FOUND", "Archived project not found");
      }
      // A restored project has its open tasks back in use, so they have to fit
      // the plan's per-project limit.
      const org = await Organization.findById(requireTenantId())
        .select("plan")
        .session(dbSession)
        .setOptions({ skipTenant: true })
        .lean();
      const taskLimit =
        PLAN_LIMITS[(org?.plan ?? "free") as Plan].activeTaskLimit;
      if (taskLimit !== null) {
        const open = await Task.countDocuments({
          projectId,
          status: { $ne: "done" },
          archivedAt: null,
          deletedAt: null,
        }).session(dbSession);
        if (open > taskLimit) {
          throw new AppError(
            409,
            "TASK_LIMIT_REACHED",
            `This project has ${open} open tasks, more than the ${PLAN_NAMES[(org?.plan ?? "free") as Plan]} plan allows (${taskLimit}). Finish or delete some, or upgrade your plan, to restore it.`,
          );
        }
      }
      const updated = await Project.findOneAndUpdate(
        { _id: projectId, archivedAt: { $ne: null } },
        { archivedAt: null, archivedReason: null },
        { new: true, session: dbSession },
      );

      if (!updated) {
        throw new AppError(404, "NOT_FOUND", "Archived project not found");
      }
      await syncProjectSlot(
        String(updated.tenantId),
        updated._id,
        false,
        dbSession,
      );

      await recordAudit(
        {
          action: "project.unarchived",
          entityType: "Project",
          entityId: projectId,
          metadata: { name: updated.name },
        },
        dbSession,
      );

      project = updated;
    });

    return project!;
  } finally {
    await dbSession.endSession();
  }
}

// Restores only force-archived resources, in caller-selected order, while
// reporting resources left archived by project or task capacity.
export async function restorePlanArchivedProjects(
  projectIds: string[],
  taskIds: string[] = [],
) {
  const tenantId = requireTenantId();
  const uniqueProjectIds = [...new Set(projectIds)];
  const uniqueTaskIds = [...new Set(taskIds)];
  const dbSession = await mongoose.startSession();
  try {
    const restored: unknown[] = [];
    const restoredTasks: unknown[] = [];
    const skipped = { projects: 0, tasks: 0 };
    await dbSession.withTransaction(async () => {
      const org = await Organization.findById(tenantId)
        .select("plan projectCount")
        .session(dbSession)
        .setOptions({ skipTenant: true })
        .lean();
      if (!org) throw new AppError(404, "NOT_FOUND", "Organization not found");
      const limits = PLAN_LIMITS[org.plan as Plan];
      const room = Math.max(0, limits.projectLimit - org.projectCount);
      const candidates = await Project.find({
        _id: { $in: uniqueProjectIds },
        archivedAt: { $ne: null },
        archivedReason: "plan_limit",
        deletedAt: null,
      }).session(dbSession);
      const ordered = new Map(candidates.map((p) => [String(p._id), p]));
      const selected = uniqueProjectIds
        .map((id) => ordered.get(id))
        .filter(Boolean) as typeof candidates;
      const taskLimit = limits.activeTaskLimit;
      let restoredCount = 0;
      for (const p of selected) {
        if (restoredCount >= room) {
          skipped.projects += 1;
          skipped.tasks += await Task.countDocuments({
            projectId: p._id,
            status: { $ne: "done" },
            archivedAt: { $ne: null },
            archivedReason: "plan_limit",
            deletedAt: null,
          }).session(dbSession);
          continue;
        }
        if (taskLimit !== null) {
          const count = await Task.countDocuments({
            projectId: p._id,
            status: { $ne: "done" },
            archivedAt: null,
            deletedAt: null,
          }).session(dbSession);
          if (count > taskLimit) {
            skipped.projects += 1;
            skipped.tasks += await Task.countDocuments({
              projectId: p._id,
              status: { $ne: "done" },
              archivedAt: { $ne: null },
              archivedReason: "plan_limit",
              deletedAt: null,
            }).session(dbSession);
            continue;
          }
        }
        const activeTaskCount = await Task.countDocuments({
          projectId: p._id,
          status: { $ne: "done" },
          archivedAt: null,
          deletedAt: null,
        }).session(dbSession);
        const archivedTasks = await Task.find({
          projectId: p._id,
          status: { $ne: "done" },
          archivedAt: { $ne: null },
          archivedReason: "plan_limit",
          deletedAt: null,
        })
          .sort({ archivedAt: 1, _id: 1 })
          .session(dbSession);
        const taskRoom =
          taskLimit === null
            ? archivedTasks.length
            : Math.max(0, taskLimit - activeTaskCount);
        const tasksToRestore = archivedTasks.slice(0, taskRoom);
        const updated = await Project.findOneAndUpdate(
          {
            _id: p._id,
            archivedAt: { $ne: null },
            archivedReason: "plan_limit",
          },
          { archivedAt: null, archivedReason: null },
          { new: true, session: dbSession },
        );
        if (!updated) continue;
        skipped.tasks += archivedTasks.length - tasksToRestore.length;
        for (const task of tasksToRestore) {
          const restoredTask = await Task.findOneAndUpdate(
            {
              _id: task._id,
              archivedAt: { $ne: null },
              archivedReason: "plan_limit",
              deletedAt: null,
            },
            { archivedAt: null, archivedReason: null },
            { new: true, session: dbSession, timestamps: false },
          );
          if (!restoredTask) continue;
          restoredTasks.push(restoredTask);
          await recordAudit(
            {
              action: "task.unarchived",
              entityType: "Task",
              entityId: restoredTask._id,
              metadata: {
                title: restoredTask.title,
                projectId: p._id,
                reason: "plan_upgrade_restore",
              },
            },
            dbSession,
          );
        }
        await syncProjectSlot(tenantId, updated._id, false, dbSession);
        await recordAudit(
          {
            action: "project.unarchived",
            entityType: "Project",
            entityId: updated._id,
            metadata: { name: updated.name, reason: "plan_upgrade_restore" },
          },
          dbSession,
        );
        restored.push(updated);
        restoredCount += 1;
      }

      if (uniqueTaskIds.length > 0) {
        const liveProjects = await Project.find({
          archivedAt: null,
          deletedAt: null,
        })
          .select("_id")
          .session(dbSession)
          .lean();
        const liveProjectIds = liveProjects.map((project) => project._id);
        const eligibleTasks = await Task.find({
          _id: { $in: uniqueTaskIds },
          projectId: { $in: liveProjectIds },
          status: { $ne: "done" },
          archivedAt: { $ne: null },
          archivedReason: "plan_limit",
          deletedAt: null,
        }).session(dbSession);
        const tasksById = new Map(
          eligibleTasks.map((task) => [String(task._id), task]),
        );
        const activeCounts = new Map<string, number>();
        const liveProjectSet = new Set(liveProjectIds.map(String));
        for (const id of uniqueTaskIds) {
          const task = tasksById.get(id);
          if (!task) continue;
          const projectId = String(task.projectId);
          if (!liveProjectSet.has(projectId)) continue;
          let activeCount = activeCounts.get(projectId);
          if (activeCount === undefined) {
            activeCount = await Task.countDocuments({
              projectId: task.projectId,
              status: { $ne: "done" },
              archivedAt: null,
              deletedAt: null,
            }).session(dbSession);
          }
          if (taskLimit !== null && activeCount >= taskLimit) {
            skipped.tasks += 1;
            continue;
          }
          const updatedTask = await Task.findOneAndUpdate(
            {
              _id: task._id,
              projectId: task.projectId,
              archivedAt: { $ne: null },
              archivedReason: "plan_limit",
              deletedAt: null,
              status: { $ne: "done" },
            },
            { archivedAt: null, archivedReason: null },
            { new: true, session: dbSession, timestamps: false },
          );
          if (!updatedTask) continue;
          activeCounts.set(projectId, activeCount + 1);
          restoredTasks.push(updatedTask);
          await recordAudit(
            {
              action: "task.unarchived",
              entityType: "Task",
              entityId: updatedTask._id,
              metadata: {
                title: updatedTask.title,
                projectId: task.projectId,
                reason: "plan_upgrade_restore",
              },
            },
            dbSession,
          );
        }
      }
    });
    return { projects: restored, tasks: restoredTasks, skipped };
  } finally {
    await dbSession.endSession();
  }
}

// Force-archived tasks in projects that stayed active are offered separately
// from projects that were archived by grace enforcement.
export async function listPlanArchivedRestoreTasks() {
  const projects = await Project.find({
    archivedAt: null,
    deletedAt: null,
  })
    .select("_id name key")
    .lean();
  if (projects.length === 0) return [];
  const projectById = new Map(
    projects.map((project) => [String(project._id), project]),
  );
  const tasks = await Task.find({
    projectId: { $in: projects.map((project) => project._id) },
    status: { $ne: "done" },
    archivedAt: { $ne: null },
    archivedReason: "plan_limit",
    deletedAt: null,
  })
    .sort({ archivedAt: 1, _id: 1 })
    .lean();
  return tasks.flatMap((task) => {
    const project = projectById.get(String(task.projectId));
    return project
      ? [
          {
            _id: task._id,
            title: task.title,
            projectId: project._id,
            projectName: project.name,
            projectKey: project.key,
            archivedAt: task.archivedAt,
          },
        ]
      : [];
  });
}

// Deleting moves a project to the bin: it disappears everywhere but can be
// restored for BIN_RETENTION_DAYS. Its slot is freed straight away.
export async function moveProjectToBin(projectId: string) {
  const tenantId = requireTenantId();
  const userId = getTenantContext()!.userId;
  const dbSession = await mongoose.startSession();

  try {
    let project;

    await dbSession.withTransaction(async () => {
      const before = await Project.findById(projectId).session(dbSession);
      if (!before) {
        throw new AppError(404, "NOT_FOUND", "Project not found");
      }
      const wasActive = await projectConsumesSlot(before._id, dbSession);
      const updated = await Project.findOneAndUpdate(
        { _id: projectId },
        { deletedAt: new Date(), deletedBy: userId },
        { new: true, session: dbSession },
      );

      if (!updated) {
        throw new AppError(404, "NOT_FOUND", "Project not found");
      }

      await syncProjectSlot(tenantId, updated._id, wasActive, dbSession);

      await recordAudit(
        {
          action: "project.binned",
          entityType: "Project",
          entityId: projectId,
          metadata: { name: updated.name, key: updated.key },
        },
        dbSession,
      );

      project = updated;
    });

    return project!;
  } finally {
    await dbSession.endSession();
  }
}

export async function restoreProject(projectId: string) {
  const tenantId = requireTenantId();
  const dbSession = await mongoose.startSession();

  try {
    let project;

    await dbSession.withTransaction(async () => {
      const before = await Project.findOne({
        _id: projectId,
        deletedAt: { $ne: null },
      })
        .session(dbSession)
        .setOptions({ includeDeleted: true });
      if (!before) {
        throw new AppError(404, "NOT_FOUND", "Project not found in the bin");
      }

      const updated = await Project.findOneAndUpdate(
        { _id: projectId, deletedAt: { $ne: null } },
        { deletedAt: null, deletedBy: null },
        { new: true, session: dbSession },
      );

      if (!updated) {
        throw new AppError(404, "NOT_FOUND", "Project not found in the bin");
      }
      await syncProjectSlot(tenantId, updated._id, false, dbSession);

      await recordAudit(
        {
          action: "project.restored",
          entityType: "Project",
          entityId: projectId,
          metadata: { name: updated.name, key: updated.key },
        },
        dbSession,
      );

      project = updated;
    });

    return project!;
  } finally {
    await dbSession.endSession();
  }
}

// Removes a project and everything in it for good.
async function destroyProject(
  project: {
    _id: mongoose.Types.ObjectId;
    tenantId: mongoose.Types.ObjectId;
  },
  dbSession: mongoose.ClientSession,
) {
  const scope = { tenantId: project.tenantId, projectId: project._id };
  await Task.deleteMany(scope)
    .session(dbSession)
    .setOptions({ skipTenant: true, includeDeleted: true });
  await TaskActivity.deleteMany(scope)
    .session(dbSession)
    .setOptions({ skipTenant: true });
  await Notification.deleteMany(scope).session(dbSession);
  await Project.deleteOne({ _id: project._id, tenantId: project.tenantId })
    .session(dbSession)
    .setOptions({ skipTenant: true });
}

export async function deleteProjectPermanently(projectId: string) {
  const dbSession = await mongoose.startSession();

  try {
    await dbSession.withTransaction(async () => {
      const project = await Project.findOne({
        _id: projectId,
        deletedAt: { $ne: null },
      }).session(dbSession);

      if (!project) {
        throw new AppError(
          404,
          "NOT_FOUND",
          "Only projects in the bin can be deleted permanently",
        );
      }

      await destroyProject(project, dbSession);

      await recordAudit(
        {
          action: "project.deleted",
          entityType: "Project",
          entityId: projectId,
          metadata: { name: project.name, key: project.key },
        },
        dbSession,
      );
    });
  } finally {
    await dbSession.endSession();
  }
}

// Permanently deletes projects that have been in the bin too long, in one
// org or (with no tenantId, from the server's hourly sweep) in every org.
export async function purgeExpiredProjects(tenantId?: string) {
  const cutoff = new Date(Date.now() - BIN_RETENTION_DAYS * DAY_MS);
  const expired = await Project.find({
    ...(tenantId ? { tenantId } : {}),
    deletedAt: { $lt: cutoff },
  })
    .limit(200)
    .setOptions({ skipTenant: true });

  for (const project of expired) {
    const dbSession = await mongoose.startSession();
    try {
      await dbSession.withTransaction(async () => {
        await destroyProject(project, dbSession);
        await recordAudit(
          {
            action: "project.purged",
            entityType: "Project",
            entityId: project._id,
            metadata: { name: project.name, key: project.key },
            tenantId: project.tenantId,
            actorId: project.deletedBy ?? project.createdBy,
          },
          dbSession,
        );
      });
    } catch (err) {
      // One that can't be removed must not stop the others being cleaned up.
      logger.error(
        { err, id: String(project._id) },
        "Could not purge an expired project",
      );
    } finally {
      await dbSession.endSession();
    }
  }

  return expired.length;
}
