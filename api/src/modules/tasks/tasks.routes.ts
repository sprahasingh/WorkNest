import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { requirePermission } from "../../auth/requirePermission.js";
import {
  createTaskSchema,
  updateTaskSchema,
  listTasksQuerySchema,
} from "./tasks.schemas.js";
import {
  createTaskController,
  listTasksController,
  getTaskController,
  updateTaskController,
  deleteTaskController,
} from "./tasks.controller.js";

const projectTasksRouter = Router({ mergeParams: true });

projectTasksRouter.get(
  "/",
  requirePermission("task:read"),
  validate({ query: listTasksQuerySchema }),
  listTasksController,
);

projectTasksRouter.post(
  "/",
  requirePermission("task:create"),
  validate({ body: createTaskSchema }),
  createTaskController,
);

const tasksRouter = Router({ mergeParams: true });

tasksRouter.get("/:taskId", requirePermission("task:read"), getTaskController);

tasksRouter.patch(
  "/:taskId",
  requirePermission("task:update:own"),
  validate({ body: updateTaskSchema }),
  updateTaskController,
);

tasksRouter.delete(
  "/:taskId",
  requirePermission("task:update:own"),
  deleteTaskController,
);

export { projectTasksRouter, tasksRouter };
