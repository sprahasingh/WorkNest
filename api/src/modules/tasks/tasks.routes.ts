import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { requirePermission } from "../../auth/requirePermission.js";
import {
  createTaskSchema,
  updateTaskSchema,
  listTasksQuerySchema,
  createActivitySchema,
} from "./tasks.schemas.js";
import {
  createTaskController,
  listTasksController,
  getTaskController,
  getTaskStatsController,
  updateTaskController,
  deleteTaskController,
  archiveTaskController,
  unarchiveTaskController,
  restoreTaskController,
  deleteTaskPermanentlyController,
} from "./tasks.controller.js";
import {
  listTaskActivitiesController,
  createTaskActivityController,
  listProjectActivitiesController,
  createProjectActivityController,
} from "./taskActivity.controller.js";

const projectTasksRouter = Router({ mergeParams: true });

projectTasksRouter.get(
  "/",
  requirePermission("task:read"),
  validate({ query: listTasksQuerySchema }),
  listTasksController,
);

projectTasksRouter.get(
  "/stats",
  requirePermission("task:read"),
  getTaskStatsController,
);

projectTasksRouter.post(
  "/",
  requirePermission("task:create"),
  validate({ body: createTaskSchema }),
  createTaskController,
);

const projectActivityRouter = Router({ mergeParams: true });

projectActivityRouter.get(
  "/",
  requirePermission("task:read"),
  listProjectActivitiesController,
);

projectActivityRouter.post(
  "/",
  requirePermission("task:comment"),
  validate({ body: createActivitySchema }),
  createProjectActivityController,
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
  requirePermission("task:delete"),
  deleteTaskController,
);

tasksRouter.patch(
  "/:taskId/archive",
  requirePermission("task:delete"),
  archiveTaskController,
);
tasksRouter.patch(
  "/:taskId/unarchive",
  requirePermission("task:delete"),
  unarchiveTaskController,
);
tasksRouter.post(
  "/:taskId/restore",
  requirePermission("task:delete"),
  restoreTaskController,
);
tasksRouter.delete(
  "/:taskId/permanent",
  requirePermission("task:delete"),
  deleteTaskPermanentlyController,
);

tasksRouter.get(
  "/:taskId/activity",
  requirePermission("task:read"),
  listTaskActivitiesController,
);

tasksRouter.post(
  "/:taskId/activity",
  requirePermission("task:comment"),
  validate({ body: createActivitySchema }),
  createTaskActivityController,
);

export { projectTasksRouter, projectActivityRouter, tasksRouter };
