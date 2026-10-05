import { z } from "zod";
import { BILLING_CYCLES } from "../../constants/plans.js";

export const createOrderSchema = z
  .object({
    plan: z.enum(["pro", "premium"]),
    billingCycle: z.enum(BILLING_CYCLES).default("monthly"),
  })
  .strict();
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const verifyPaymentSchema = z
  .object({
    orderId: z.string().min(1).max(100),
    paymentId: z.string().min(1).max(100),
    signature: z.string().min(1).max(200),
  })
  .strict();
export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;
