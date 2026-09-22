import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { requirePermission } from "../../auth/requirePermission.js";
import { updateOrgSchema, changePlanSchema } from "./orgs.schemas.js";
import {
  getOrgController,
  updateOrgController,
  changePlanController,
} from "./orgs.controller.js";

const router = Router({ mergeParams: true });

router.get("/", requirePermission("project:read"), getOrgController);

router.patch(
  "/",
  requirePermission("org:update"),
  validate({ body: updateOrgSchema }),
  updateOrgController,
);

router.post(
  "/plan",
  requirePermission("plan:change"),
  validate({ body: changePlanSchema }),
  changePlanController,
);

export { router as orgsRouter };
