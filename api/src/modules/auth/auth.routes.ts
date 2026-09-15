import { Router } from "express";
import rateLimit from "express-rate-limit";
import { validate } from "../../middleware/validate.js";
import { registerSchema } from "./auth.schemas.js";
import { registerController, loginController } from "./auth.controller.js";
import { loginSchema } from "./auth.schemas.js";

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

export { router as authRouter };
