import type { Request, Response } from "express";
import {
  createTask,
  listTasks,
  getTask,
  updateTask,
  deleteTask,
  archiveTask,
  unarchiveTask,
  restoreTask,
  deleteTaskPermanently,
  getTaskStats,
  countTasksByView,
} from "./tasks.service.js";
import type {
  CreateTaskInput,
  UpdateTaskInput,
  ListTasksQuery,
  TaskCountsQuery,
} from "./tasks.schemas.js";

export async function createTaskController(
  req: Request,
  res: Response,
): Promise<void> {
  const { projectId } = req.params;
  const input = req.validated!.body as CreateTaskInput;
  const userId = req.auth!.userId;

  const task = await createTask(projectId as string, input, userId);

  res.status(201).json({ task });
}

export async function listTasksController(
  req: Request,
  res: Response,
): Promise<void> {
  const { projectId } = req.params;
  const query = req.validated!.query as ListTasksQuery;

  const result = await listTasks(projectId as string, query);

  res.status(200).json(result);
}

export async function getTaskCountsController(
  req: Request,
  res: Response,
): Promise<void> {
  const { projectId } = req.params;
  const counts = await countTasksByView(
    projectId as string,
    req.validated!.query as TaskCountsQuery,
  );
  res.status(200).json({ counts });
}

export async function getTaskStatsController(
  req: Request,
  res: Response,
): Promise<void> {
  const { projectId } = req.params;
  const stats = await getTaskStats(projectId as string);
  res.status(200).json(stats);
}

export async function getTaskController(
  req: Request,
  res: Response,
): Promise<void> {
  const { taskId } = req.params;
  const task = await getTask(taskId as string);
  res.status(200).json({ task });
}

export async function updateTaskController(
  req: Request,
  res: Response,
): Promise<void> {
  const { taskId } = req.params;
  const input = req.validated!.body as UpdateTaskInput;
  const task = await updateTask(taskId as string, input);
  res.status(200).json({ task });
}

export async function deleteTaskController(
  req: Request,
  res: Response,
): Promise<void> {
  const { taskId } = req.params;
  await deleteTask(taskId as string);
  res.status(204).send();
}

export async function archiveTaskController(
  req: Request,
  res: Response,
): Promise<void> {
  const task = await archiveTask(req.params.taskId as string);
  res.status(200).json({ task });
}

export async function unarchiveTaskController(
  req: Request,
  res: Response,
): Promise<void> {
  const task = await unarchiveTask(req.params.taskId as string);
  res.status(200).json({ task });
}

export async function restoreTaskController(
  req: Request,
  res: Response,
): Promise<void> {
  const task = await restoreTask(req.params.taskId as string);
  res.status(200).json({ task });
}

export async function deleteTaskPermanentlyController(
  req: Request,
  res: Response,
): Promise<void> {
  await deleteTaskPermanently(req.params.taskId as string);
  res.status(204).send();
}
