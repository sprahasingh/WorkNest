import { Router } from "express";
import { authenticate } from "../../auth/authenticate.js";
import {
  acceptMyInviteController,
  declineMyInviteController,
  listMyInvitesController,
} from "./invites.controller.js";

// Invitations addressed to the signed-in user, from any organization.
const router = Router();

router.use(authenticate);

router.get("/", listMyInvitesController);

router.post("/:inviteId/accept", acceptMyInviteController);
router.post("/:inviteId/decline", declineMyInviteController);

export { router as myInvitesRouter };
