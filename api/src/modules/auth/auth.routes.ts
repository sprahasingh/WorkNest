import { Router } from "express";
import rateLimit from "express-rate-limit";
import { validate } from "../../middleware/validate.js";
import { authenticate } from "../../auth/authenticate.js";
import {
  registerSchema,
  loginSchema,
  updatePersonalInformationSchema,
} from "./auth.schemas.js";
import {
  registerController,
  loginController,
  refreshController,
  logoutController,
  meController,
  deleteAccountController,
  updatePersonalInformationController,
} from "./auth.controller.js";

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const accountUpdateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post(
  "/register",
  authLimiter,
  validate({ body: registerSchema }),
  registerController,
);

router.post(
  "/login",
  authLimiter,
  validate({ body: loginSchema }),
  loginController,
);

router.post("/refresh", authLimiter, refreshController);
router.post("/logout", logoutController);
router.get("/me", authenticate, meController);
router.patch(
  "/me",
  accountUpdateLimiter,
  authenticate,
  validate({ body: updatePersonalInformationSchema }),
  updatePersonalInformationController,
);
router.delete("/me", authenticate, deleteAccountController);

export { router as authRouter };
