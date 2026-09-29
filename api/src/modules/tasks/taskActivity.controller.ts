import type { Request, Response } from "express";
import { createActivity, listActivities } from "./taskActivity.service.js";
import type { CreateActivityInput } from "./tasks.schemas.js";

export async function listActivitiesController(
  req: Request,
  res: Response,
): Promise<void> {
  const { taskId } = req.params;
  const activities = await listActivities(taskId as string);
  res.status(200).json({ activities });
}

export async function createActivityController(
  req: Request,
  res: Response,
): Promise<void> {
  const { taskId } = req.params;
  const input = req.validated!.body as CreateActivityInput;
  const activity = await createActivity(taskId as string, input);
  res.status(201).json({ activity });
}
