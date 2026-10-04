import { Router } from "express";
import rateLimit from "express-rate-limit";
import { validate } from "../../middleware/validate.js";
import { requirePermission } from "../../auth/requirePermission.js";
import { createOrderSchema, verifyPaymentSchema } from "./billing.schemas.js";
import {
  billingConfigController,
  createOrderController,
  verifyPaymentController,
} from "./billing.controller.js";

const router = Router({ mergeParams: true });

const orderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get("/", requirePermission("plan:change"), billingConfigController);

router.post(
  "/order",
  orderLimiter,
  requirePermission("plan:change"),
  validate({ body: createOrderSchema }),
  createOrderController,
);

router.post(
  "/verify",
  requirePermission("plan:change"),
  validate({ body: verifyPaymentSchema }),
  verifyPaymentController,
);

export { router as billingRouter };
