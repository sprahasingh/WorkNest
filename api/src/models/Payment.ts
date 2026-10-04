import { Schema, model, type InferSchemaType } from "mongoose";
import { PLANS } from "../constants/plans.js";
import { tenantPlugin } from "../tenancy/plugin.js";

// One row per attempt to pay for a plan upgrade. Only the ids Razorpay gives
// us are kept. Card details never reach this server.
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
    // In paise.
    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    razorpayOrderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String, default: null },
    status: {
      type: String,
      enum: ["created", "paid"],
      default: "created",
    },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true },
);

paymentSchema.index({ tenantId: 1, createdAt: -1 });
paymentSchema.plugin(tenantPlugin);

export type PaymentDocument = InferSchemaType<typeof paymentSchema>;
export const Payment = model("Payment", paymentSchema);
