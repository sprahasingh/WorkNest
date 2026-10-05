import { scaled } from "../../lib/rateLimit.js";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { validate } from "../../middleware/validate.js";
import { requirePermission } from "../../auth/requirePermission.js";
import {
  createOrderSchema,
  testPlanDatesSchema,
  verifyPaymentSchema,
} from "./billing.schemas.js";
import {
  billingConfigController,
  createOrderController,
  testPlanDatesController,
  verifyPaymentController,
} from "./billing.controller.js";

const router = Router({ mergeParams: true });

const orderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: scaled(30),
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

// Test accounts only (EMAIL_VERIFICATION_BYPASS_EMAILS), checked in the
// service on top of the admin permission.
router.post(
  "/test-plan-dates",
  requirePermission("plan:change"),
  validate({ body: testPlanDatesSchema }),
  testPlanDatesController,
);

export { router as billingRouter };
