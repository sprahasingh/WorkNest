import type { Request, Response } from "express";
import {
  createTask,
  listTasks,
  getTask,
  updateTask,
  deleteTask,
} from "./tasks.service.js";
import type {
  CreateTaskInput,
  UpdateTaskInput,
  ListTasksQuery,
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
