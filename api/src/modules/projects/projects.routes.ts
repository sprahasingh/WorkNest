import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { requirePermission } from "../../auth/requirePermission.js";
import {
  createProjectSchema,
  updateProjectSchema,
  listProjectsQuerySchema,
} from "./projects.schemas.js";
import {
  createProjectController,
  listProjectsController,
  getProjectController,
  updateProjectController,
  archiveProjectController,
  deleteProjectController,
} from "./projects.controller.js";

const router = Router({ mergeParams: true });

router.get(
  "/",
  requirePermission("project:read"),
  validate({ query: listProjectsQuerySchema }),
  listProjectsController,
);

router.post(
  "/",
  requirePermission("project:write"),
  validate({ body: createProjectSchema }),
  createProjectController,
);

router.get(
  "/:projectId",
  requirePermission("project:read"),
  getProjectController,
);

router.patch(
  "/:projectId",
  requirePermission("project:write"),
  validate({ body: updateProjectSchema }),
  updateProjectController,
);

router.post(
  "/:projectId/archive",
  requirePermission("project:write"),
  archiveProjectController,
);

router.delete(
  "/:projectId",
  requirePermission("project:write"),
  deleteProjectController,
);

export { router as projectsRouter };
