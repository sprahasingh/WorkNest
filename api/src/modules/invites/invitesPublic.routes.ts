import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { authenticate } from "../../auth/authenticate.js";
import { inviteSignupSchema } from "./invites.schemas.js";
import {
  getInviteByTokenController,
  acceptInviteController,
  signupViaInviteController,
} from "./invites.controller.js";

const router = Router();

router.get("/:token", getInviteByTokenController);

router.post("/:token/accept", authenticate, acceptInviteController);

router.post(
  "/:token/signup",
  validate({ body: inviteSignupSchema }),
  signupViaInviteController,
);

export { router as invitesPublicRouter };
