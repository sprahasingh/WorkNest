import { env } from "../../config/env.js";
import {
  PLAN_PRICE_PAISE,
  planEndDate,
  planRank,
  upgradeAmountPaise,
  type Plan,
} from "../../constants/plans.js";
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

async function currentPlan(tenantId: string): Promise<Plan> {
  const org = await Organization.findById(tenantId)
    .select("plan")
    .setOptions({ skipTenant: true })
    .lean();
  return (org?.plan ?? "free") as Plan;
}

// What the app needs to show the upgrade buttons: whether paying is switched
// on, the key the browser needs, and what each step up costs from here.
export async function getBillingConfig() {
  const tenantId = requireTenantId();
  const plan = await currentPlan(tenantId);
  const upgrades = (["pro", "premium"] as const)
    .filter((target) => planRank(target) > planRank(plan))
    .map((target) => ({
      plan: target,
      amount: upgradeAmountPaise(plan, target),
    }));
  const recent = await Payment.find({ status: "paid" })
    .sort({ paidAt: -1 })
    .limit(5)
    .lean();
  return {
    enabled: isRazorpayConfigured(),
    keyId: env.RAZORPAY_KEY_ID ?? null,
    prices: PLAN_PRICE_PAISE,
    upgrades,
    payments: recent.map((payment) => ({
      id: String(payment._id),
      plan: payment.plan,
      amount: payment.amount,
      paidAt: payment.paidAt,
    })),
  };
}

export async function createOrder(target: Exclude<Plan, "free">) {
  if (!isRazorpayConfigured()) {
    throw new AppError(
      503,
      "PAYMENTS_DISABLED",
      "Payments are not switched on for this app.",
    );
  }
  const context = requireContext();
  const from = await currentPlan(context.tenantId);
  if (planRank(target) <= planRank(from)) {
    throw new AppError(
      409,
      "ALREADY_ON_PLAN",
      "This organization is already on that plan or a higher one.",
    );
  }
  const amount = upgradeAmountPaise(from, target);
  const order = await createRazorpayOrder({
    amount,
    receipt: `wn_${Date.now().toString(36)}`,
    notes: { tenantId: context.tenantId, plan: target },
  });
  await Payment.create({
    tenantId: context.tenantId,
    userId: context.userId,
    fromPlan: from,
    plan: target,
    amount,
    razorpayOrderId: order.id,
  });
  return {
    orderId: order.id,
    amount,
    currency: order.currency,
    keyId: env.RAZORPAY_KEY_ID!,
    plan: target,
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
      .lean();
    if (!existing) {
      throw new AppError(
        404,
        "NOT_FOUND",
        "No payment was found for that order",
      );
    }
    // Marked paid but the plan never moved (the server stopped in between, or
    // another request is still applying it): finish the job. It never moves
    // anyone down, and does nothing when the plan is already there.
    if (existing.status === "paid") {
      await runWithTenant(
        {
          tenantId: String(existing.tenantId),
          userId: String(existing.userId),
        },
        async () => {
          const plan = await currentPlan(String(existing.tenantId));
          if (planRank(existing.plan as Plan) > planRank(plan)) {
            await changePlan(
              existing.plan as Plan,
              {
                paymentId: existing.razorpayPaymentId ?? paymentId,
                orderId,
                amount: existing.amount,
              },
              planEndDate(existing.paidAt ?? new Date()),
            );
          }
        },
      );
    }
    return { applied: false };
  }

  try {
    await runWithTenant(
      {
        tenantId: String(claimed.tenantId),
        userId: String(claimed.userId),
      },
      async () => {
        const plan = await currentPlan(String(claimed.tenantId));
        // Never move someone down because of a late or repeated payment.
        if (planRank(claimed.plan as Plan) > planRank(plan)) {
          await changePlan(
            claimed.plan as Plan,
            {
              paymentId,
              orderId,
              amount: claimed.amount,
            },
            planEndDate(claimed.paidAt ?? new Date()),
          );
        }
      },
    );
  } catch (error) {
    // Put it back so a retry (the webhook, or the person) can finish the job.
    await Payment.updateOne(
      { _id: claimed._id },
      { status: "created", razorpayPaymentId: null, paidAt: null },
    ).setOptions({ skipTenant: true });
    logger.error({ err: error, orderId }, "Could not apply a paid plan");
    throw error;
  }
  return { applied: true };
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
