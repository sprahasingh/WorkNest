import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { requirePermission } from "../../auth/requirePermission.js";
import { updateOrgSchema } from "./orgs.schemas.js";
import { getOrgController, updateOrgController } from "./orgs.controller.js";

const router = Router({ mergeParams: true });

router.get("/", requirePermission("project:read"), getOrgController);
router.patch(
  "/",
  requirePermission("org:update"),
  validate({ body: updateOrgSchema }),
  updateOrgController,
);

export { router as orgsRouter };
