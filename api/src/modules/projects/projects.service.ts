import mongoose from "mongoose";
import { BIN_RETENTION_DAYS, Project } from "../../models/Project.js";
import { Task } from "../../models/Task.js";
import { TaskActivity } from "../../models/TaskActivity.js";
import { Notification } from "../../models/Notification.js";
import { getTenantContext, requireTenantId } from "../../tenancy/context.js";
import { AppError } from "../../lib/errors.js";
import {
  reserveProjectSlot,
  releaseProjectSlot,
} from "../orgs/orgs.service.js";
import { recordAudit } from "../audit/audit.service.js";
import type {
  CreateProjectInput,
  UpdateProjectInput,
} from "./projects.schemas.js";

export async function createProject(
  input: CreateProjectInput,
  createdBy: string,
) {
  const tenantId = requireTenantId();
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

  const [projects, activeCount, archivedCount, binCount] = await Promise.all([
    Project.find(VIEW_FILTERS[view]).sort(
      view === "bin" ? { deletedAt: -1 } : { createdAt: -1 },
    ),
    Project.countDocuments(VIEW_FILTERS.active),
    Project.countDocuments(VIEW_FILTERS.archived),
    Project.countDocuments(VIEW_FILTERS.bin),
  ]);

  // Per-project task totals. Active means not done, the same count the
  // plan's per-project task limit is measured against.
  const taskCounts = await Task.aggregate<{
    _id: mongoose.Types.ObjectId;
    total: number;
    active: number;
  }>([
    {
      $match: {
        projectId: { $in: projects.map((p) => p._id) },
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
      },
    },
  ]);
  const countsByProject = new Map(
    taskCounts.map((row) => [String(row._id), row]),
  );

  return {
    projects: projects.map((project) => {
      const counts = countsByProject.get(String(project._id));
      return {
        ...project.toJSON(),
        activeTaskCount: counts?.active ?? 0,
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
  const dbSession = await mongoose.startSession();

  try {
    let project;

    await dbSession.withTransaction(async () => {
      const before = await Project.findById(projectId).session(dbSession);

      if (!before) {
        throw new AppError(404, "NOT_FOUND", "Project not found");
      }

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (input.name !== undefined && input.name !== before.name) {
        changes.name = { from: before.name, to: input.name };
      }
      if (
        input.description !== undefined &&
        input.description !== before.description
      ) {
        changes.description = {
          from: before.description,
          to: input.description,
        };
      }

      const updated = await Project.findByIdAndUpdate(projectId, input, {
        new: true,
        runValidators: true,
        session: dbSession,
      });

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

export async function archiveProject(projectId: string) {
  const dbSession = await mongoose.startSession();

  try {
    let project;

    await dbSession.withTransaction(async () => {
      const updated = await Project.findByIdAndUpdate(
        projectId,
        { archivedAt: new Date() },
        { new: true, session: dbSession },
      );

      if (!updated) {
        throw new AppError(404, "NOT_FOUND", "Project not found");
      }

      await recordAudit(
        {
          action: "project.archived",
          entityType: "Project",
          entityId: projectId,
          metadata: {},
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
      const updated = await Project.findOneAndUpdate(
        { _id: projectId, archivedAt: { $ne: null } },
        { archivedAt: null },
        { new: true, session: dbSession },
      );

      if (!updated) {
        throw new AppError(404, "NOT_FOUND", "Archived project not found");
      }

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

// Deleting moves a project to the bin: it disappears everywhere but can be
// restored for BIN_RETENTION_DAYS. Its slot is freed straight away.
export async function moveProjectToBin(projectId: string) {
  const tenantId = requireTenantId();
  const userId = getTenantContext()!.userId;
  const dbSession = await mongoose.startSession();

  try {
    let project;

    await dbSession.withTransaction(async () => {
      const updated = await Project.findOneAndUpdate(
        { _id: projectId },
        { deletedAt: new Date(), deletedBy: userId },
        { new: true, session: dbSession },
      );

      if (!updated) {
        throw new AppError(404, "NOT_FOUND", "Project not found");
      }

      await releaseProjectSlot(tenantId, dbSession);

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
      // Needs a free project slot again, like creating one.
      await reserveProjectSlot(tenantId, dbSession);

      const updated = await Project.findOneAndUpdate(
        { _id: projectId, deletedAt: { $ne: null } },
        { deletedAt: null, deletedBy: null },
        { new: true, session: dbSession },
      );

      if (!updated) {
        throw new AppError(404, "NOT_FOUND", "Project not found in the bin");
      }

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
  }).setOptions({ skipTenant: true });

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
    } finally {
      await dbSession.endSession();
    }
  }

  return expired.length;
}
