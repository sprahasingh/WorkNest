import { env } from "../../config/env.js";
import {
  BILLING_CYCLES,
  PLAN_PRICE_PAISE,
  planRank,
  quotePlan,
  type BillingCycle,
  type Plan,
} from "../../constants/plans.js";
import { expirePlanIfDue } from "./planLifecycle.js";
import { AppError } from "../../lib/errors.js";
import {
  createRazorpayOrder,
  isRazorpayConfigured,
  verifyPaymentSignature,
} from "../../lib/razorpay.js";
import { logger } from "../../lib/logger.js";
import { Organization } from "../../models/Organization.js";
import { Payment } from "../../models/Payment.js";
import {
  getTenantContext,
  requireTenantId,
  runWithTenant,
} from "../../tenancy/context.js";
import { changePlan } from "../orgs/orgs.service.js";

async function currentBilling(tenantId: string) {
  const org = await Organization.findById(tenantId)
    .select("plan planExpiresAt billingCycle")
    .setOptions({ skipTenant: true })
    .lean();
  return {
    plan: (org?.plan ?? "free") as Plan,
    planExpiresAt: org?.planExpiresAt ?? null,
    billingCycle: (org?.billingCycle ?? null) as BillingCycle | null,
  };
}

// What the app needs to show the buy buttons: whether paying is switched on,
// the key the browser needs, the price list, and what each choice costs this
// organization right now (null where it can't be bought).
export async function getBillingConfig() {
  const tenantId = requireTenantId();
  const billing = await currentBilling(tenantId);
  const quotes = Object.fromEntries(
    (["pro", "premium"] as const).map((target) => [
      target,
      Object.fromEntries(
        BILLING_CYCLES.map((cycle) => {
          const quote = quotePlan(billing, target, cycle);
          return [cycle, quote && { amount: quote.amount }];
        }),
      ),
    ]),
  );
  const recent = await Payment.find({ status: "paid" })
    .sort({ paidAt: -1 })
    .limit(5)
    .lean();
  return {
    enabled: isRazorpayConfigured(),
    keyId: env.RAZORPAY_KEY_ID ?? null,
    prices: PLAN_PRICE_PAISE,
    quotes,
    payments: recent.map((payment) => ({
      id: String(payment._id),
      plan: payment.plan,
      billingCycle: payment.billingCycle,
      amount: payment.amount,
      paidAt: payment.paidAt,
    })),
  };
}

export async function createOrder(
  target: Exclude<Plan, "free">,
  cycle: BillingCycle,
) {
  if (!isRazorpayConfigured()) {
    throw new AppError(
      503,
      "PAYMENTS_DISABLED",
      "Payments are not switched on for this app.",
    );
  }
  const context = requireContext();
  const billing = await currentBilling(context.tenantId);
  const from = billing.plan;
  const quote = quotePlan(billing, target, cycle);
  if (!quote) {
    throw new AppError(
      409,
      "ALREADY_ON_PLAN",
      "This organization is already on a higher plan.",
    );
  }
  const amount = quote.amount;
  const order = await createRazorpayOrder({
    amount,
    receipt: `wn_${Date.now().toString(36)}`,
    notes: { tenantId: context.tenantId, plan: target, cycle },
  });
  await Payment.create({
    tenantId: context.tenantId,
    userId: context.userId,
    fromPlan: from,
    plan: target,
    billingCycle: cycle,
    amount,
    razorpayOrderId: order.id,
  });
  return {
    orderId: order.id,
    amount,
    currency: order.currency,
    keyId: env.RAZORPAY_KEY_ID!,
    plan: target,
    billingCycle: cycle,
  };
}

function requireContext() {
  const tenantId = requireTenantId();
  // requireTenantId throws without a context, so the context exists here.
  return { tenantId, userId: getTenantContext()!.userId };
}

// Marks the order paid and moves the organization up. Safe to call twice (the
// browser and the webhook both do): only the call that flips the status
// applies the plan.
export async function applyPaidOrder(
  orderId: string,
  paymentId: string,
  capturedAmount?: number,
): Promise<{ applied: boolean }> {
  // The webhook says how much was really paid. If that isn't what the order
  // was for, nothing is applied.
  if (capturedAmount !== undefined) {
    const order = await Payment.findOne({ razorpayOrderId: orderId })
      .setOptions({ skipTenant: true })
      .select("amount")
      .lean();
    if (order && order.amount !== capturedAmount) {
      throw new AppError(
        409,
        "AMOUNT_MISMATCH",
        "The amount paid doesn't match the order",
      );
    }
  }
  const claimed = await Payment.findOneAndUpdate(
    { razorpayOrderId: orderId, status: "created" },
    {
      status: "paid",
      razorpayPaymentId: paymentId,
      paidAt: new Date(),
    },
    { returnDocument: "after" },
  ).setOptions({ skipTenant: true });

  if (!claimed) {
    const existing = await Payment.findOne({ razorpayOrderId: orderId })
      .setOptions({ skipTenant: true })
      .select("_id")
      .lean();
    if (!existing) {
      throw new AppError(
        404,
        "NOT_FOUND",
        "No payment was found for that order",
      );
    }
  }
  // Paid but the plan never moved (the server stopped in between): finish the
  // job. Only one caller applies a payment, so a repeat can't extend it twice.
  const applied = await applyPayment(orderId, paymentId);
  return { applied: claimed !== null && applied };
}

const APPLY_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
const APPLY_CLAIM_STALE_MS = 2 * 60 * 1000;

async function applyPayment(
  orderId: string,
  paymentId: string,
): Promise<boolean> {
  const now = Date.now();
  const payment = await Payment.findOneAndUpdate(
    {
      razorpayOrderId: orderId,
      status: "paid",
      appliedAt: null,
      paidAt: { $gt: new Date(now - APPLY_RETRY_WINDOW_MS) },
      $or: [
        { applyingAt: null },
        { applyingAt: { $lt: new Date(now - APPLY_CLAIM_STALE_MS) } },
      ],
    },
    { applyingAt: new Date(now) },
    { returnDocument: "after" },
  ).setOptions({ skipTenant: true });
  if (!payment) return false;

  try {
    await runWithTenant(
      { tenantId: String(payment.tenantId), userId: String(payment.userId) },
      async () => {
        const tenantId = String(payment.tenantId);
        await expirePlanIfDue(tenantId);
        const billing = await currentBilling(tenantId);
        const target = payment.plan as Plan;
        const cycle = (payment.billingCycle ?? "monthly") as BillingCycle;
        // Never move someone down because of a late payment.
        if (planRank(target) < planRank(billing.plan)) return;
        const paidAt = payment.paidAt ?? new Date();
        const quote = quotePlan(billing, target, cycle, paidAt);
        await changePlan(
          target,
          {
            paymentId: payment.razorpayPaymentId ?? paymentId,
            orderId,
            amount: payment.amount,
          },
          quote ? { expiresAt: quote.expiresAt, cycle } : null,
        );
      },
    );
  } catch (error) {
    // Let a retry (the webhook, or the person) finish the job.
    await Payment.updateOne(
      { _id: payment._id },
      { applyingAt: null },
    ).setOptions({ skipTenant: true });
    logger.error({ err: error, orderId }, "Could not apply a paid plan");
    throw error;
  }
  await Payment.updateOne(
    { _id: payment._id },
    { appliedAt: new Date() },
  ).setOptions({ skipTenant: true });
  return true;
}

export async function confirmPayment(input: {
  orderId: string;
  paymentId: string;
  signature: string;
}) {
  const tenantId = requireTenantId();
  // Scoped to this organization: nobody can confirm another org's order.
  const payment = await Payment.findOne({
    razorpayOrderId: input.orderId,
  }).lean();
  if (!payment || String(payment.tenantId) !== tenantId) {
    throw new AppError(404, "NOT_FOUND", "No payment was found for that order");
  }
  if (
    !verifyPaymentSignature(input.orderId, input.paymentId, input.signature)
  ) {
    throw new AppError(
      400,
      "PAYMENT_SIGNATURE_INVALID",
      "We couldn't confirm that payment.",
    );
  }
  await applyPaidOrder(input.orderId, input.paymentId);
  const org = await Organization.findById(tenantId).setOptions({
    skipTenant: true,
  });
  return org!;
}
