import { Router } from "express";
import rateLimit from "express-rate-limit";
import { validate } from "../../middleware/validate.js";
import { authenticate } from "../../auth/authenticate.js";
import {
  registerSchema,
  loginSchema,
  requestEmailChangeSchema,
  updatePersonalInformationSchema,
  verifyEmailChangeSchema,
  verifyRegistrationSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
} from "./auth.schemas.js";
import {
  registerController,
  loginController,
  refreshController,
  logoutController,
  meController,
  deleteAccountController,
  requestEmailChangeController,
  updatePersonalInformationController,
  verifyEmailChangeController,
  verifyRegistrationController,
  requestPasswordResetController,
  resetPasswordController,
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

const verificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordResetLimiter = rateLimit({
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
  "/verify-registration",
  verificationLimiter,
  validate({ body: verifyRegistrationSchema }),
  verifyRegistrationController,
);

router.post(
  "/login",
  authLimiter,
  validate({ body: loginSchema }),
  loginController,
);
router.post(
  "/forgot-password",
  passwordResetLimiter,
  validate({ body: requestPasswordResetSchema }),
  requestPasswordResetController,
);
router.post(
  "/reset-password",
  passwordResetLimiter,
  validate({ body: resetPasswordSchema }),
  resetPasswordController,
);

router.post("/refresh", authLimiter, refreshController);
router.post("/logout", logoutController);
router.post(
  "/verify-email-change",
  verificationLimiter,
  validate({ body: verifyEmailChangeSchema }),
  verifyEmailChangeController,
);
router.get("/me", authenticate, meController);
router.patch(
  "/me",
  accountUpdateLimiter,
  authenticate,
  validate({ body: updatePersonalInformationSchema }),
  updatePersonalInformationController,
);
router.post(
  "/me/email-change",
  accountUpdateLimiter,
  authenticate,
  validate({ body: requestEmailChangeSchema }),
  requestEmailChangeController,
);
router.delete("/me", authenticate, deleteAccountController);

export { router as authRouter };
