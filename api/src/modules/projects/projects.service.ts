import mongoose from "mongoose";
import { Project } from "../../models/Project.js";
import { Task } from "../../models/Task.js";
import { TaskActivity } from "../../models/TaskActivity.js";
import { Notification } from "../../models/Notification.js";
import { requireTenantId } from "../../tenancy/context.js";
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

      const existing = await Project.findOne({ key: input.key }).session(
        dbSession,
      );

      if (existing) {
        await releaseProjectSlot(tenantId, dbSession);
        throw new AppError(
          409,
          "CONFLICT",
          "A project with this key already exists",
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

export async function listProjects(archived: boolean) {
  const [projects, activeCount, archivedCount] = await Promise.all([
    Project.find(
      archived ? { archivedAt: { $ne: null } } : { archivedAt: null },
    ).sort({ createdAt: -1 }),
    Project.countDocuments({ archivedAt: null }),
    Project.countDocuments({ archivedAt: { $ne: null } }),
  ]);

  // Per-project task totals. Active means not done, the same count the
  // plan's per-project task limit is measured against.
  const taskCounts = await Task.aggregate<{
    _id: mongoose.Types.ObjectId;
    total: number;
    active: number;
  }>([
    { $match: { projectId: { $in: projects.map((p) => p._id) } } },
    {
      $group: {
        _id: "$projectId",
        total: { $sum: 1 },
        active: { $sum: { $cond: [{ $ne: ["$status", "done"] }, 1, 0] } },
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
      };
    }),
    counts: { active: activeCount, archived: archivedCount },
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

export async function deleteProject(projectId: string) {
  const tenantId = requireTenantId();
  const dbSession = await mongoose.startSession();

  try {
    await dbSession.withTransaction(async () => {
      const project = await Project.findById(projectId).session(dbSession);

      if (!project) {
        throw new AppError(404, "NOT_FOUND", "Project not found");
      }

      await Task.deleteMany({ projectId }).session(dbSession);
      await TaskActivity.deleteMany({ projectId }).session(dbSession);
      await Notification.deleteMany({ tenantId, projectId }).session(dbSession);
      await Project.deleteOne({ _id: projectId }).session(dbSession);
      await releaseProjectSlot(tenantId, dbSession);

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
