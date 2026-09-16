import { Router } from "express";
import rateLimit from "express-rate-limit";
import { validate } from "../../middleware/validate.js";
import { authenticate } from "../../auth/authenticate.js";
import { registerSchema, loginSchema } from "./auth.schemas.js";
import {
  registerController,
  loginController,
  refreshController,
  logoutController,
  meController,
} from "./auth.controller.js";

const router = Router();

const authLimiter = rateLimit({
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

export { router as authRouter };
