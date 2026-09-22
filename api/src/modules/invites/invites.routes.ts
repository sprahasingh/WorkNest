import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { requirePermission } from "../../auth/requirePermission.js";
import { createInviteSchema } from "./invites.schemas.js";
import {
  createInviteController,
  listInvitesController,
  revokeInviteController,
} from "./invites.controller.js";

const router = Router({ mergeParams: true });

router.get("/", requirePermission("invite:manage"), listInvitesController);

router.post(
  "/",
  requirePermission("invite:manage"),
  validate({ body: createInviteSchema }),
  createInviteController,
);

router.delete(
  "/:inviteId",
  requirePermission("invite:manage"),
  revokeInviteController,
);

export { router as invitesRouter };
