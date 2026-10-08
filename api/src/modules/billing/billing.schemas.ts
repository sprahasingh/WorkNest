import { z } from "zod";
import { BILLING_CYCLES } from "../../constants/plans.js";

// Razorpay identifiers are opaque strings with provider-specific prefixes.
// Restrict them to the characters used by the provider and our test fixtures
// before they can be used in Mongo filters or persisted to payment records.
export const razorpayOrderIdSchema = z
  .string()
  .regex(/^order_[A-Za-z0-9_-]{1,95}$/);
export const razorpayPaymentIdSchema = z
  .string()
  .regex(/^pay_[A-Za-z0-9_-]{1,96}$/);

export const createOrderSchema = z
  .object({
    plan: z.enum(["pro", "premium"]),
    billingCycle: z.enum(BILLING_CYCLES).default("monthly"),
    quoteToken: z.string().min(1).max(4096).optional(),
  })
  .strict();
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const verifyPaymentSchema = z
  .object({
    orderId: razorpayOrderIdSchema,
    paymentId: razorpayPaymentIdSchema,
    signature: z.string().min(1).max(200),
  })
  .strict();

export const scheduleFreeDowngradeSchema = z
  .object({ impactFingerprint: z.string().min(32).max(128) })
  .strict();
export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;

// Test controls: move a plan's end date (or, once it has ended, the date it
// ended) so expiry, the grace period, reminders and archiving can be tried
// without waiting. null clears the date.
export const testPlanDatesSchema = z
  .object({
    planExpiresAt: z
      .union([z.iso.datetime({ offset: true }), z.null()])
      .optional(),
    planExpiredAt: z
      .union([z.iso.datetime({ offset: true }), z.null()])
      .optional(),
    // Run the expiry, grace period and reminder checks for this organization
    // straight away instead of waiting for the next sweep.
    run: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.planExpiresAt !== undefined ||
      value.planExpiredAt !== undefined ||
      value.run === true,
    { message: "Give a date to set, or run the checks" },
  );
export type TestPlanDatesInput = z.infer<typeof testPlanDatesSchema>;
