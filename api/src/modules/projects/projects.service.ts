import mongoose from "mongoose";
import { Project } from "../../models/Project.js";
import { Task } from "../../models/Task.js";
import { requireTenantId } from "../../tenancy/context.js";
import { AppError } from "../../lib/errors.js";
import {
  reserveProjectSlot,
  releaseProjectSlot,
} from "../orgs/orgs.service.js";
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

      project = created;
    });

    return project!;
  } finally {
    await dbSession.endSession();
  }
}

export async function listProjects(archived: boolean) {
  return Project.find(
    archived ? { archivedAt: { $ne: null } } : { archivedAt: null },
  ).sort({ createdAt: -1 });
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
  const project = await Project.findByIdAndUpdate(projectId, input, {
    new: true,
    runValidators: true,
  });

  if (!project) {
    throw new AppError(404, "NOT_FOUND", "Project not found");
  }

  return project;
}

export async function archiveProject(projectId: string) {
  const project = await Project.findByIdAndUpdate(
    projectId,
    { archivedAt: new Date() },
    { new: true },
  );

  if (!project) {
    throw new AppError(404, "NOT_FOUND", "Project not found");
  }

  return project;
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
      await Project.deleteOne({ _id: projectId }).session(dbSession);
      await releaseProjectSlot(tenantId, dbSession);
    });
  } finally {
    await dbSession.endSession();
  }
}
