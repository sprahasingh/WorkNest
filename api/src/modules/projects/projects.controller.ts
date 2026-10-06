import type { Request, Response } from "express";
import { AppError } from "../../lib/errors.js";
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  archiveProject,
  unarchiveProject,
  moveProjectToBin,
  restoreProject,
  deleteProjectPermanently,
  restorePlanArchivedProjects,
  listPlanArchivedRestoreTasks,
  keepPlanArchivedResource,
} from "./projects.service.js";
import type {
  CreateProjectInput,
  UpdateProjectInput,
  ListProjectsQuery,
} from "./projects.schemas.js";

export async function restorePlanArchivedProjectsController(
  req: Request,
  res: Response,
): Promise<void> {
  const input = req.validated!.body as {
    projectIds: string[];
    taskIds?: string[];
  };
  const result = await restorePlanArchivedProjects(
    input.projectIds,
    input.taskIds ?? [],
  );
  res.status(200).json(result);
}

export async function listPlanArchivedRestoreTasksController(
  _req: Request,
  res: Response,
): Promise<void> {
  const tasks = await listPlanArchivedRestoreTasks();
  res.status(200).json({ tasks });
}

export async function keepPlanArchivedResourceController(
  req: Request,
  res: Response,
): Promise<void> {
  const kind = req.params.kind as "project" | "task";
  if (kind !== "project" && kind !== "task") {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Resource type must be project or task",
    );
  }
  const resource = await keepPlanArchivedResource(
    kind,
    req.params.resourceId as string,
  );
  res.status(200).json({ resource });
}

export async function createProjectController(
  req: Request,
  res: Response,
): Promise<void> {
  const input = req.validated!.body as CreateProjectInput;
  const userId = req.auth!.userId;
  const project = await createProject(input, userId);
  res.status(201).json({ project });
}

export async function listProjectsController(
  req: Request,
  res: Response,
): Promise<void> {
  const query = req.validated!.query as ListProjectsQuery;
  const view =
    query.view ?? (query.archived === "true" ? "archived" : "active");
  const result = await listProjects(view);
  res.status(200).json(result);
}

export async function getProjectController(
  req: Request,
  res: Response,
): Promise<void> {
  const { projectId } = req.params;
  const project = await getProject(projectId as string);
  res.status(200).json({ project });
}

export async function updateProjectController(
  req: Request,
  res: Response,
): Promise<void> {
  const { projectId } = req.params;
  const input = req.validated!.body as UpdateProjectInput;
  const project = await updateProject(projectId as string, input);
  res.status(200).json({ project });
}

export async function archiveProjectController(
  req: Request,
  res: Response,
): Promise<void> {
  const { projectId } = req.params;
  const project = await archiveProject(projectId as string);
  res.status(200).json({ project });
}

export async function unarchiveProjectController(
  req: Request,
  res: Response,
): Promise<void> {
  const project = await unarchiveProject(req.params.projectId as string);
  res.status(200).json({ project });
}

// DELETE moves the project to the bin; it can be restored for 30 days.
export async function deleteProjectController(
  req: Request,
  res: Response,
): Promise<void> {
  const project = await moveProjectToBin(req.params.projectId as string);
  res.status(200).json({ project });
}

export async function restoreProjectController(
  req: Request,
  res: Response,
): Promise<void> {
  const project = await restoreProject(req.params.projectId as string);
  res.status(200).json({ project });
}

export async function deleteProjectPermanentlyController(
  req: Request,
  res: Response,
): Promise<void> {
  await deleteProjectPermanently(req.params.projectId as string);
  res.status(204).send();
}
