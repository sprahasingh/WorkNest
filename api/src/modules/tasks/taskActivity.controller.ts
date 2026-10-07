import type { Request, Response } from "express";
import {
  createProjectActivity,
  createWorkspaceProjectActivity,
  createTaskActivity,
  listProjectActivities,
  listWorkspaceProjectActivities,
  listTaskActivities,
  markAnswer,
  remindWaiting,
} from "./taskActivity.service.js";
import type { CreateActivityInput, MarkAnswerInput } from "./tasks.schemas.js";

// Task routes carry :taskId and project routes :projectId; the same
// handlers serve both.
function activityScope(req: Request) {
  const { taskId, projectId } = req.params;
  return taskId
    ? { taskId: taskId as string }
    : { projectId: projectId as string };
}

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
  const result = await createTaskActivity(taskId as string, input);
  res.status(201).json(result);
}

export async function listProjectActivitiesController(
  req: Request,
  res: Response,
): Promise<void> {
  const { projectId } = req.params;
  const activities = await listProjectActivities(projectId as string);
  res.status(200).json({ activities });
}

export async function listWorkspaceProjectActivitiesController(
  _req: Request,
  res: Response,
): Promise<void> {
  const activities = await listWorkspaceProjectActivities();
  res.status(200).json({ activities });
}

export async function createProjectActivityController(
  req: Request,
  res: Response,
): Promise<void> {
  const { projectId } = req.params;
  const input = req.validated!.body as CreateActivityInput;
  const result = await createProjectActivity(projectId as string, input);
  res.status(201).json(result);
}

export async function createWorkspaceProjectActivityController(
  req: Request,
  res: Response,
): Promise<void> {
  const input = req.validated!.body as CreateActivityInput;
  const result = await createWorkspaceProjectActivity(input);
  res.status(201).json(result);
}

export async function markAnswerController(
  req: Request,
  res: Response,
): Promise<void> {
  const input = req.validated!.body as MarkAnswerInput;
  const activity = await markAnswer(
    activityScope(req),
    req.params.activityId as string,
    input,
  );
  res.status(200).json({ activity });
}

export async function remindWaitingController(
  req: Request,
  res: Response,
): Promise<void> {
  const result = await remindWaiting(
    activityScope(req),
    req.params.activityId as string,
  );
  res.status(200).json(result);
}
