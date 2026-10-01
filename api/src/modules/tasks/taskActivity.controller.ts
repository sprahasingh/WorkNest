import type { Request, Response } from "express";
import {
  createProjectActivity,
  createTaskActivity,
  listProjectActivities,
  listTaskActivities,
} from "./taskActivity.service.js";
import type { CreateActivityInput } from "./tasks.schemas.js";

export async function listTaskActivitiesController(
  req: Request,
  res: Response,
): Promise<void> {
  const { taskId } = req.params;
  const activities = await listTaskActivities(taskId as string);
  res.status(200).json({ activities });
}

export async function createTaskActivityController(
  req: Request,
  res: Response,
): Promise<void> {
  const { taskId } = req.params;
  const input = req.validated!.body as CreateActivityInput;
  const { activity, notifiedCount } = await createTaskActivity(
    taskId as string,
    input,
  );
  res.status(201).json({ activity, notifiedCount });
}

export async function listProjectActivitiesController(
  req: Request,
  res: Response,
): Promise<void> {
  const { projectId } = req.params;
  const activities = await listProjectActivities(projectId as string);
  res.status(200).json({ activities });
}

export async function createProjectActivityController(
  req: Request,
  res: Response,
): Promise<void> {
  const { projectId } = req.params;
  const input = req.validated!.body as CreateActivityInput;
  const { activity, notifiedCount } = await createProjectActivity(
    projectId as string,
    input,
  );
  res.status(201).json({ activity, notifiedCount });
}
