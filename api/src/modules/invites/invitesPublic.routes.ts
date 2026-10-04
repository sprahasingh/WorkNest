import { scaled } from "../../lib/rateLimit.js";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { validate } from "../../middleware/validate.js";
import { authenticate } from "../../auth/authenticate.js";
import { inviteSignupSchema } from "./invites.schemas.js";
import {
  getInviteByTokenController,
  acceptInviteController,
  declineInviteController,
  signupViaInviteController,
} from "./invites.controller.js";

const router = Router();
const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: scaled(10),
  standardHeaders: true,
  legacyHeaders: false,
});

router.get("/:token", getInviteByTokenController);

router.post("/:token/accept", authenticate, acceptInviteController);
router.post("/:token/decline", authenticate, declineInviteController);

router.post(
  "/:token/signup",
  signupLimiter,
  validate({ body: inviteSignupSchema }),
  signupViaInviteController,
);

export { router as invitesPublicRouter };
