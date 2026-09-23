import type { Request, Response } from "express";
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  archiveProject,
  deleteProject,
} from "./projects.service.js";
import type {
  CreateProjectInput,
  UpdateProjectInput,
  ListProjectsQuery,
} from "./projects.schemas.js";

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
  const archived = query.archived === "true";
  const projects = await listProjects(archived);
  res.status(200).json({ projects });
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

export async function deleteProjectController(
  req: Request,
  res: Response,
): Promise<void> {
  const { projectId } = req.params;
  await deleteProject(projectId as string);
  res.status(204).send();
}
