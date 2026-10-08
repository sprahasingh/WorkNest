import { Schema, model, type InferSchemaType } from "mongoose";
import { BILLING_CYCLES, PLANS } from "../constants/plans.js";
import { tenantPlugin } from "../tenancy/plugin.js";

// One row per subscription purchase attempt. Only the ids Razorpay gives us
// are kept. Card details never reach this server.
const paymentSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      immutable: true,
    },
    // Who started the payment, so the audit log can name them.
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    fromPlan: { type: String, enum: PLANS, required: true },
    plan: { type: String, enum: PLANS, required: true },
    billingCycle: { type: String, enum: BILLING_CYCLES, default: "monthly" },
    // In paise.
    amount: { type: Number, required: true },
    quotedExpiresAt: { type: Date, default: null },
    quotedCreditStartedAt: { type: Date, default: null },
    quotedCreditValuePaise: { type: Number, default: null },
    quoteToken: { type: String, default: null },
    currency: { type: String, default: "INR" },
    razorpayOrderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String, default: null },
    status: {
      type: String,
      enum: ["created", "paid"],
      default: "created",
    },
    paidAt: { type: Date, default: null },
    // When the plan was actually moved. Paid but not applied means a retry
    // should finish the job.
    applyingAt: { type: Date, default: null },
    appliedAt: { type: Date, default: null },
    refundStatus: {
      type: String,
      enum: ["none", "processing", "refunded"],
      default: "none",
    },
    refundId: { type: String, default: null },
    refundReceipt: { type: String, default: null },
    refundProcessingAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

paymentSchema.index({ tenantId: 1, createdAt: -1 });
// The billing summary lists the latest paid orders.
paymentSchema.index({ tenantId: 1, status: 1, paidAt: -1 });
paymentSchema.plugin(tenantPlugin);

export type PaymentDocument = InferSchemaType<typeof paymentSchema>;
export const Payment = model("Payment", paymentSchema);
