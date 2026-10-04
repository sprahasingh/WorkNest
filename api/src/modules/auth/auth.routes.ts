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
  resendVerificationSchema,
  registrationStatusSchema,
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
  markOnboardingSeenController,
  resendEmailChangeController,
  requestEmailChangeController,
  cancelEmailChangeController,
  updatePersonalInformationController,
  verifyEmailChangeController,
  verifyRegistrationController,
  resendVerificationController,
  registrationStatusController,
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

// Refresh runs on every page load and every 15 minutes, so it gets its own,
// roomier budget instead of sharing login's.
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
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
  "/resend-verification",
  verificationLimiter,
  validate({ body: resendVerificationSchema }),
  resendVerificationController,
);
// Polled every few seconds while someone waits for their email link, so it
// has a larger allowance of its own.
const registrationStatusLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
router.post(
  "/registration-status",
  registrationStatusLimiter,
  validate({ body: registrationStatusSchema }),
  registrationStatusController,
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

router.post("/refresh", refreshLimiter, refreshController);
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
router.post(
  "/me/email-change/resend",
  verificationLimiter,
  authenticate,
  resendEmailChangeController,
);
router.delete(
  "/me/email-change",
  accountUpdateLimiter,
  authenticate,
  cancelEmailChangeController,
);
router.post("/me/onboarding", authenticate, markOnboardingSeenController);
router.delete("/me", authenticate, deleteAccountController);

export { router as authRouter };
