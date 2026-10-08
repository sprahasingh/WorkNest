import { env } from "../../config/env.js";
import {
  BILLING_CYCLES,
  PLAN_PRICE_PAISE,
  planRank,
  quotePlan,
  type BillingCycle,
  type Plan,
} from "../../constants/plans.js";
import {
  enforceGraceFully,
  expirePlanIfDue,
  getPlanImpact,
  getPlanUsage,
} from "./planLifecycle.js";
import { sendPlanRenewalReminders } from "./planReminders.js";
import { isTestControlEmail } from "../../lib/testControls.js";
import { User } from "../../models/User.js";
import { recordAudit } from "../audit/audit.service.js";
import type { TestPlanDatesInput } from "./billing.schemas.js";
import { AppError } from "../../lib/errors.js";
import {
  createRazorpayOrder,
  isRazorpayConfigured,
  refundRazorpayPayment,
  simulatedUpgradesAllowed,
  verifyPaymentSignature,
} from "../../lib/razorpay.js";
import mongoose from "mongoose";
import { createHmac, timingSafeEqual } from "node:crypto";
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
    .select(
      "plan planExpiresAt billingCycle planCreditStartedAt planCreditValuePaise planExpiredFrom scheduledPlan scheduledBillingCycle scheduledStartsAt scheduledExpiresAt scheduledPaymentId",
    )
    .setOptions({ skipTenant: true })
    .lean();
  return {
    plan: (org?.plan ?? "free") as Plan,
    planExpiresAt: org?.planExpiresAt ?? null,
    billingCycle: (org?.billingCycle ?? null) as BillingCycle | null,
    planCreditStartedAt: org?.planCreditStartedAt ?? null,
    planCreditValuePaise: org?.planCreditValuePaise ?? null,
    scheduledPlan: (org?.scheduledPlan ?? null) as Plan | null,
    scheduledBillingCycle: (org?.scheduledBillingCycle ??
      null) as BillingCycle | null,
    scheduledStartsAt: org?.scheduledStartsAt ?? null,
    scheduledExpiresAt: org?.scheduledExpiresAt ?? null,
    scheduledPaymentId: org?.scheduledPaymentId ?? null,
    planExpiredFrom: (org?.planExpiredFrom ?? null) as Plan | null,
  };
}

const QUOTE_LIFETIME_MS = 10 * 60 * 1000;
interface SignedPlanQuote {
  tenantId: string;
  plan: Exclude<Plan, "free">;
  cycle: BillingCycle;
  state: {
    plan: Plan;
    planExpiresAt: string | null;
    billingCycle: BillingCycle | null;
    planCreditStartedAt: string | null;
    planCreditValuePaise: number | null;
    scheduledPlan: Plan | null;
    scheduledBillingCycle: BillingCycle | null;
    scheduledStartsAt: string | null;
    scheduledExpiresAt: string | null;
  };
  quote: NonNullable<ReturnType<typeof quotePlan>>;
  impactFingerprint?: string;
  expiresAt: number;
}

function quoteState(billing: Awaited<ReturnType<typeof currentBilling>>) {
  return {
    plan: billing.plan,
    planExpiresAt: billing.planExpiresAt?.toISOString() ?? null,
    billingCycle: billing.billingCycle,
    planCreditStartedAt: billing.planCreditStartedAt?.toISOString() ?? null,
    planCreditValuePaise: billing.planCreditValuePaise ?? null,
    scheduledPlan: billing.scheduledPlan,
    scheduledBillingCycle: billing.scheduledBillingCycle,
    scheduledStartsAt: billing.scheduledStartsAt?.toISOString() ?? null,
    scheduledExpiresAt: billing.scheduledExpiresAt?.toISOString() ?? null,
  };
}

function quoteSignature(payload: string) {
  return createHmac("sha256", env.JWT_ACCESS_SECRET)
    .update(payload)
    .digest("base64url");
}

function signPlanQuote(
  tenantId: string,
  plan: Exclude<Plan, "free">,
  cycle: BillingCycle,
  billing: Awaited<ReturnType<typeof currentBilling>>,
  quote: NonNullable<ReturnType<typeof quotePlan>>,
  impactFingerprint?: string,
) {
  const payload = Buffer.from(
    JSON.stringify({
      tenantId,
      plan,
      cycle,
      state: quoteState(billing),
      quote,
      impactFingerprint,
      expiresAt: Date.now() + QUOTE_LIFETIME_MS,
    } satisfies SignedPlanQuote),
  ).toString("base64url");
  return `${payload}.${quoteSignature(payload)}`;
}

function readPlanQuote(token: string, tenantId: string, checkExpiry = true) {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    throw new AppError(409, "QUOTE_EXPIRED", "Refresh the subscription quote.");
  }
  const expected = Buffer.from(quoteSignature(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new AppError(
      400,
      "INVALID_QUOTE",
      "The subscription quote is invalid.",
    );
  }
  let claims: SignedPlanQuote;
  try {
    claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as SignedPlanQuote;
  } catch {
    throw new AppError(
      400,
      "INVALID_QUOTE",
      "The subscription quote is invalid.",
    );
  }
  if (claims.tenantId !== tenantId) {
    throw new AppError(
      404,
      "NOT_FOUND",
      "The subscription quote was not found.",
    );
  }
  if (checkExpiry && claims.expiresAt <= Date.now()) {
    throw new AppError(409, "QUOTE_EXPIRED", "Refresh the subscription quote.");
  }
  return claims;
}

// What the app needs to show the buy buttons: whether paying is switched on,
// the key the browser needs, the price list, and what each choice costs this
// organization right now (null where it can't be bought).
export async function getBillingConfig() {
  const tenantId = requireTenantId();
  const billing = await currentBilling(tenantId);
  const lowerPlans = (["free", "pro"] as const).filter(
    (target) => planRank(target) < planRank(billing.plan),
  );
  const impactEntries = await Promise.all(
    lowerPlans.map(
      async (target) =>
        [target, await getPlanImpact(tenantId, target)] as const,
    ),
  );
  const impacts = Object.fromEntries(impactEntries);
  const quotes = Object.fromEntries(
    (["pro", "premium"] as const).map((target) => [
      target,
      Object.fromEntries(
        BILLING_CYCLES.map((cycle) => {
          const quote = quotePlan(billing, target, cycle);
          return [
            cycle,
            quote && {
              ...quote,
              impact: impacts[target] ?? null,
              startsAt:
                (quote.scheduled ||
                  (target === billing.plan &&
                    billing.planExpiresAt! > new Date())) &&
                billing.planExpiresAt
                  ? billing.planExpiresAt
                  : new Date(),
              quoteToken: signPlanQuote(
                tenantId,
                target,
                cycle,
                billing,
                quote,
                impacts[target]?.fingerprint,
              ),
            },
          ];
        }),
      ),
    ]),
  );
  const recent = await Payment.find({ status: "paid" })
    .sort({ paidAt: -1 })
    .limit(5)
    .lean();
  return {
    testControls: await canUseTestControls(),
    enabled: isRazorpayConfigured(),
    simulationAllowed: !isRazorpayConfigured() && simulatedUpgradesAllowed(),
    keyId: env.RAZORPAY_KEY_ID ?? null,
    prices: PLAN_PRICE_PAISE,
    current: {
      plan: billing.plan,
      billingCycle: billing.billingCycle,
      planExpiresAt: billing.planExpiresAt,
    },
    scheduledChange: billing.scheduledPlan
      ? {
          plan: billing.scheduledPlan,
          billingCycle: billing.scheduledBillingCycle,
          startsAt: billing.scheduledStartsAt,
          expiresAt: billing.scheduledExpiresAt,
          prepaid: Boolean(billing.scheduledPaymentId),
        }
      : null,
    quotes,
    impacts,
    payments: recent.map((payment) => ({
      id: String(payment._id),
      plan: payment.plan,
      billingCycle: payment.billingCycle,
      amount: payment.amount,
      paidAt: payment.paidAt,
    })),
  };
}

export async function scheduleFreeDowngrade(impactFingerprint: string) {
  const { tenantId } = requireContext();
  const impact = await getPlanImpact(tenantId, "free");
  if (impact.fingerprint !== impactFingerprint) {
    throw new AppError(
      409,
      "USAGE_CHANGED",
      "Workspace usage changed. Review the updated plan impact before scheduling.",
      [impact],
    );
  }
  const now = new Date();
  const current = await Organization.findById(tenantId)
    .select("plan planExpiresAt")
    .setOptions({ skipTenant: true })
    .lean();
  const alreadyScheduled = await Organization.findById(tenantId)
    .select("scheduledPlan")
    .setOptions({ skipTenant: true })
    .lean();
  if (alreadyScheduled?.scheduledPlan === "free")
    return Organization.findById(tenantId).setOptions({ skipTenant: true });
  if (
    !current ||
    current.plan === "free" ||
    !current.planExpiresAt ||
    current.planExpiresAt <= now
  ) {
    throw new AppError(
      409,
      "PLAN_CHANGE_CONFLICT",
      "There is no active paid plan to schedule.",
    );
  }
  const session = await mongoose.startSession();
  let org;
  try {
    await session.withTransaction(async () => {
      org = await Organization.findOneAndUpdate(
        {
          _id: tenantId,
          plan: current.plan,
          scheduledPlan: null,
          $expr: {
            $and: [
              { $eq: ["$planExpiresAt", current.planExpiresAt] },
              { $gt: ["$planExpiresAt", now] },
            ],
          },
        },
        {
          scheduledPlan: "free",
          scheduledBillingCycle: null,
          scheduledStartsAt: current.planExpiresAt,
          scheduledExpiresAt: null,
          scheduledPaymentId: null,
        },
        { returnDocument: "after", session },
      ).setOptions({ skipTenant: true });
      if (!org)
        throw new AppError(
          409,
          "PLAN_CHANGE_CONFLICT",
          "There is no active paid plan to schedule, or another plan change is already pending.",
        );
      await recordAudit(
        {
          action: "plan.change_scheduled",
          entityType: "Organization",
          entityId: tenantId,
          metadata: {
            from: org.plan,
            to: "free",
            startsAt: org.planExpiresAt,
            amount: 0,
          },
        },
        session,
      );
    });
  } finally {
    await session.endSession();
  }
  if (!org) {
    throw new AppError(
      409,
      "PLAN_CHANGE_CONFLICT",
      "There is no active paid plan to schedule, or another plan change is already pending.",
    );
  }
  return org;
}

export async function cancelScheduledChange() {
  const { tenantId } = requireContext();
  const org = await Organization.findById(tenantId).setOptions({
    skipTenant: true,
  });
  if (org && !org.scheduledPlan) return org;
  if (
    !org?.scheduledPlan ||
    !org.scheduledStartsAt ||
    org.scheduledStartsAt <= new Date()
  ) {
    throw new AppError(
      409,
      "NO_PENDING_PLAN_CHANGE",
      "There is no scheduled plan change to cancel.",
    );
  }
  if (org.scheduledPaymentId) {
    const payment = await Payment.findOne({
      _id: org.scheduledPaymentId,
      tenantId,
    }).setOptions({ skipTenant: true });
    if (!payment || payment.status !== "paid" || !payment.razorpayPaymentId) {
      throw new AppError(
        409,
        "PREPAID_PLAN_INVALID",
        "The prepaid plan cannot be safely refunded, so the scheduled change remains in place.",
      );
    }
    const receipt = `wn_cancel_${String(payment._id)}`;
    const claimed = await Payment.findOneAndUpdate(
      {
        _id: payment._id,
        $or: [
          { refundStatus: "none" },
          {
            refundStatus: "processing",
            refundProcessingAt: { $lt: new Date(Date.now() - 5 * 60_000) },
          },
        ],
      },
      {
        refundStatus: "processing",
        refundReceipt: receipt,
        refundProcessingAt: new Date(),
      },
      { returnDocument: "after" },
    ).setOptions({ skipTenant: true });
    if (!claimed)
      throw new AppError(
        409,
        "REFUND_IN_PROGRESS",
        "The refund is already being processed.",
      );
    try {
      const refund = await refundRazorpayPayment({
        paymentId: payment.razorpayPaymentId,
        amount: payment.amount,
        receipt,
      });
      await Payment.updateOne(
        { _id: payment._id, refundStatus: "processing" },
        {
          refundStatus: "refunded",
          refundId: refund.id,
          refundedAt: new Date(),
          refundProcessingAt: null,
        },
      ).setOptions({ skipTenant: true });
    } catch (error) {
      await Payment.updateOne(
        { _id: payment._id, refundStatus: "processing" },
        { refundStatus: "none", refundProcessingAt: null },
      ).setOptions({ skipTenant: true });
      throw error;
    }
  }
  const session = await mongoose.startSession();
  let cleared;
  try {
    await session.withTransaction(async () => {
      cleared = await Organization.findOneAndUpdate(
        {
          _id: tenantId,
          scheduledPlan: org.scheduledPlan,
          scheduledStartsAt: org.scheduledStartsAt,
          scheduledPaymentId: org.scheduledPaymentId,
        },
        {
          $set: {
            scheduledPlan: null,
            scheduledBillingCycle: null,
            scheduledStartsAt: null,
            scheduledExpiresAt: null,
            scheduledPaymentId: null,
          },
        },
        { returnDocument: "after", session },
      ).setOptions({ skipTenant: true });
      if (!cleared) return;
      await recordAudit(
        {
          action: "plan.change_schedule_cancelled",
          entityType: "Organization",
          entityId: tenantId,
          metadata: {
            plan: org.scheduledPlan,
            refunded: Boolean(org.scheduledPaymentId),
          },
        },
        session,
      );
    });
  } finally {
    await session.endSession();
  }
  if (!cleared) {
    if (org.scheduledPaymentId) {
      const payment = await Payment.findById(org.scheduledPaymentId)
        .setOptions({ skipTenant: true })
        .lean();
      if (payment?.refundStatus === "refunded")
        return Organization.findById(tenantId).setOptions({ skipTenant: true });
    }
    throw new AppError(
      409,
      "PLAN_CHANGE_CONFLICT",
      "The scheduled change was applied while cancellation was processing.",
    );
  }
  return cleared;
}

export async function createOrder(
  target: Exclude<Plan, "free">,
  cycle: BillingCycle,
  quoteToken?: string,
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
  if (billing.scheduledPlan) {
    throw new AppError(
      409,
      "PENDING_PLAN_CHANGE",
      "Cancel the scheduled plan change before starting another billing action.",
    );
  }
  const from = billing.plan;
  const signedQuote = quoteToken
    ? readPlanQuote(quoteToken, context.tenantId)
    : null;
  if (
    signedQuote &&
    (signedQuote.plan !== target || signedQuote.cycle !== cycle)
  ) {
    throw new AppError(
      400,
      "INVALID_QUOTE",
      "The subscription quote is invalid.",
    );
  }
  if (planRank(target) < planRank(billing.plan)) {
    if (!signedQuote?.impactFingerprint) {
      throw new AppError(
        409,
        "QUOTE_EXPIRED",
        "Refresh the plan impact before continuing.",
      );
    }
    const impact = await getPlanImpact(context.tenantId, target);
    if (impact.fingerprint !== signedQuote.impactFingerprint) {
      throw new AppError(
        409,
        "USAGE_CHANGED",
        "Workspace usage changed. Review the updated plan impact before payment.",
        [impact],
      );
    }
  }
  if (
    signedQuote &&
    JSON.stringify(signedQuote.state) !== JSON.stringify(quoteState(billing))
  ) {
    throw new AppError(
      409,
      "QUOTE_EXPIRED",
      "Your subscription changed. Refresh the quote.",
    );
  }
  const quote = signedQuote?.quote ?? quotePlan(billing, target, cycle);
  if (!quote) {
    throw new AppError(
      409,
      "ALREADY_ON_PLAN",
      "This organization is already on a higher plan.",
    );
  }
  const amount = quote.amount;
  if (amount === 0) {
    await changePlan(
      target,
      undefined,
      {
        expiresAt: quote.expiresAt,
        cycle,
        creditStartedAt: quote.creditStartedAt,
        creditValuePaise: quote.creditValuePaise,
      },
      signedQuote?.state ?? quoteState(billing),
    );
    return {
      orderId: null,
      amount: 0,
      currency: "INR",
      keyId: null,
      plan: target,
      billingCycle: cycle,
      paidByCredit: true,
    };
  }
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
    quotedExpiresAt: quote.expiresAt,
    quotedCreditStartedAt: quote.creditStartedAt,
    quotedCreditValuePaise: quote.creditValuePaise,
    quoteToken: quoteToken ?? null,
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
      const receipt = `wn_mismatch_${String(order._id)}`;
      const claim = await Payment.findOneAndUpdate(
        {
          _id: order._id,
          status: { $in: ["created", "paid"] },
          $or: [
            { refundStatus: "none" },
            {
              refundStatus: "processing",
              refundProcessingAt: { $lt: new Date(Date.now() - 5 * 60_000) },
            },
          ],
        },
        {
          status: "paid",
          razorpayPaymentId: paymentId,
          paidAt: new Date(),
          refundStatus: "processing",
          refundReceipt: receipt,
          refundProcessingAt: new Date(),
        },
        { returnDocument: "after" },
      ).setOptions({ skipTenant: true });
      if (claim) {
        try {
          const refund = await refundRazorpayPayment({
            paymentId,
            amount: capturedAmount,
            receipt,
          });
          await Payment.updateOne(
            { _id: claim._id, refundStatus: "processing" },
            {
              appliedAt: new Date(),
              refundStatus: "refunded",
              refundId: refund.id,
              refundedAt: new Date(),
              refundProcessingAt: null,
            },
          ).setOptions({ skipTenant: true });
        } catch (error) {
          await Payment.updateOne(
            { _id: claim._id, refundStatus: "processing" },
            { refundStatus: "none", refundProcessingAt: null },
          ).setOptions({ skipTenant: true });
          throw error;
        }
      }
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
      refundStatus: "none",
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
      refundStatus: "none",
      appliedAt: null,
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
        const paidAt = payment.paidAt ?? new Date();
        const signedQuote = payment.quoteToken
          ? readPlanQuote(payment.quoteToken, tenantId, false)
          : null;
        if (signedQuote && signedQuote.plan !== target) {
          throw new AppError(
            409,
            "QUOTE_EXPIRED",
            "The subscription quote no longer matches this payment.",
          );
        }
        if (
          signedQuote &&
          signedQuote.state.plan === billing.plan &&
          JSON.stringify(signedQuote.state) !==
            JSON.stringify(quoteState(billing))
        ) {
          throw new AppError(
            409,
            "QUOTE_EXPIRED",
            "The subscription changed before payment was applied.",
          );
        }
        const scheduledStart = signedQuote?.quote.scheduled
          ? signedQuote.quote.creditStartedAt
          : null;
        // A paid webhook may arrive after the expiry processor already moved
        // the source plan to Free. Honor a payment captured before expiry and
        // activate the remaining purchased term without overlapping plans.
        if (
          billing.plan === "free" &&
          billing.planExpiredFrom === payment.fromPlan &&
          scheduledStart &&
          paidAt <= scheduledStart &&
          signedQuote &&
          signedQuote.quote.expiresAt > new Date()
        ) {
          await changePlan(
            target,
            {
              paymentId: payment.razorpayPaymentId ?? paymentId,
              orderId,
              amount: payment.amount,
            },
            {
              expiresAt: signedQuote.quote.expiresAt,
              cycle,
              creditStartedAt: scheduledStart,
              creditValuePaise: payment.amount,
            },
            quoteState(billing),
          );
          return;
        }
        // Never move someone down because of a late payment.
        if (planRank(target) < planRank(billing.plan)) {
          const startsAt = billing.planExpiresAt;
          if (!startsAt || startsAt <= paidAt || !payment.quotedExpiresAt) {
            throw new AppError(
              409,
              "QUOTE_EXPIRED",
              "The subscription expired before the scheduled plan was paid.",
            );
          }
          const dbSession = await mongoose.startSession();
          try {
            await dbSession.withTransaction(async () => {
              const updated = await Organization.findOneAndUpdate(
                {
                  _id: tenantId,
                  plan: billing.plan,
                  planExpiresAt: startsAt,
                  scheduledPlan: null,
                },
                {
                  scheduledPlan: target,
                  scheduledBillingCycle: cycle,
                  scheduledStartsAt: startsAt,
                  scheduledExpiresAt: payment.quotedExpiresAt,
                  scheduledPaymentId: payment._id,
                },
                { session: dbSession, returnDocument: "after" },
              ).setOptions({ skipTenant: true });
              if (!updated)
                throw new AppError(
                  409,
                  "PENDING_PLAN_CHANGE",
                  "A subscription change is already scheduled or the current plan changed.",
                );
              await recordAudit(
                {
                  action: "plan.change_scheduled",
                  entityType: "Organization",
                  entityId: tenantId,
                  metadata: {
                    from: billing.plan,
                    to: target,
                    billingCycle: cycle,
                    startsAt,
                    expiresAt: payment.quotedExpiresAt,
                    paymentId: payment.razorpayPaymentId ?? paymentId,
                  },
                },
                dbSession,
              );
            });
          } finally {
            await dbSession.endSession();
          }
          return;
        }
        const computedQuote = quotePlan(billing, target, cycle, paidAt);
        const quote =
          signedQuote?.quote ??
          (payment.quotedExpiresAt
            ? {
                amount: payment.amount,
                expiresAt: payment.quotedExpiresAt,
                creditStartedAt: payment.quotedCreditStartedAt ?? paidAt,
                creditValuePaise:
                  payment.quotedCreditValuePaise ?? payment.amount,
              }
            : computedQuote);
        await changePlan(
          target,
          {
            paymentId: payment.razorpayPaymentId ?? paymentId,
            orderId,
            amount: payment.amount,
          },
          quote
            ? {
                expiresAt: quote.expiresAt,
                cycle,
                creditStartedAt: quote.creditStartedAt,
                creditValuePaise: quote.creditValuePaise,
              }
            : null,
          signedQuote?.state,
        );
      },
    );
  } catch (error) {
    if (
      error instanceof AppError &&
      ["QUOTE_EXPIRED", "PENDING_PLAN_CHANGE", "PLAN_CHANGE_CONFLICT"].includes(
        error.code,
      ) &&
      payment.razorpayPaymentId
    ) {
      // A captured order that lost its quote or schedule race must be returned,
      // never left as prepaid value with no corresponding subscription.
      const receipt = `wn_stale_${String(payment._id)}`;
      const refund = await refundRazorpayPayment({
        paymentId: payment.razorpayPaymentId,
        amount: payment.amount,
        receipt,
      });
      await Payment.updateOne(
        { _id: payment._id },
        {
          applyingAt: null,
          appliedAt: new Date(),
          refundStatus: "refunded",
          refundId: refund.id,
          refundReceipt: receipt,
          refundedAt: new Date(),
        },
      ).setOptions({ skipTenant: true });
      throw error;
    }
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
  try {
    await applyPaidOrder(input.orderId, input.paymentId);
  } catch (error) {
    const pending = await Payment.findOne({
      razorpayOrderId: input.orderId,
      tenantId,
    })
      .select("status appliedAt refundStatus")
      .setOptions({ skipTenant: true })
      .lean();
    if (
      pending?.status === "paid" &&
      !pending.appliedAt &&
      pending.refundStatus !== "refunded"
    ) {
      throw new AppError(
        409,
        "PAYMENT_PROCESSING",
        "Payment is verified and the subscription update is still processing. Refresh Plans shortly; the payment will not be applied twice.",
      );
    }
    throw error;
  }
  const appliedPayment = await Payment.findOne({
    razorpayOrderId: input.orderId,
    tenantId,
  })
    .select("appliedAt refundStatus")
    .setOptions({ skipTenant: true })
    .lean();
  if (
    !appliedPayment?.appliedAt &&
    appliedPayment?.refundStatus !== "refunded"
  ) {
    throw new AppError(
      409,
      "PAYMENT_PROCESSING",
      "Payment is verified and the subscription update is still processing. Refresh Plans shortly; the payment will not be applied twice.",
    );
  }
  const org = await Organization.findById(tenantId).setOptions({
    skipTenant: true,
  });
  return org!;
}

// Test-only tools are for the accounts in EMAIL_VERIFICATION_BYPASS_EMAILS.
export async function canUseTestControls(): Promise<boolean> {
  const user = await User.findById(getTenantContext()!.userId)
    .select("email")
    .lean();
  return isTestControlEmail(user?.email);
}

// Moves the end date of a paid plan, or the date a plan ended, and can run the
// expiry, grace period and reminder checks straight away. Only for the test
// accounts: anyone else gets a plain "not found".
export async function setTestPlanDates(input: TestPlanDatesInput) {
  if (!(await canUseTestControls())) {
    throw new AppError(404, "NOT_FOUND", "Not found");
  }
  const tenantId = requireTenantId();
  const org = await Organization.findById(tenantId)
    .select("plan planExpiredFrom")
    .setOptions({ skipTenant: true })
    .lean();
  if (!org) throw new AppError(404, "NOT_FOUND", "Organization not found");

  const changes: Record<string, unknown> = {};
  if (input.planExpiresAt !== undefined) {
    if (org.plan === "free") {
      throw new AppError(
        409,
        "NOT_ON_PAID_PLAN",
        "This workspace is on Free. Set the date it ended instead (planExpiredAt).",
      );
    }
    changes.planExpiresAt =
      input.planExpiresAt === null ? null : new Date(input.planExpiresAt);
  }
  if (input.planExpiredAt !== undefined) {
    if (org.plan !== "free") {
      throw new AppError(
        409,
        "NOT_EXPIRED",
        "This workspace is on a paid plan. Set its end date instead (planExpiresAt).",
      );
    }
    changes.planExpiredAt =
      input.planExpiredAt === null ? null : new Date(input.planExpiredAt);
    changes.planExpiredFrom = org.planExpiredFrom ?? "pro";
    // Lets the grace period and archiving run again from the new date.
    changes.graceEnforcedAt = null;
    changes.graceEnforcingAt = null;
    changes.graceArchived = null;
  }

  if (Object.keys(changes).length > 0) {
    const dbSession = await mongoose.startSession();
    try {
      await dbSession.withTransaction(async () => {
        await Organization.updateOne({ _id: tenantId }, changes, {
          session: dbSession,
        }).setOptions({ skipTenant: true });
        await recordAudit(
          {
            action: "plan.test_dates_set",
            entityType: "Organization",
            entityId: tenantId,
            metadata: { test: true, ...input },
          },
          dbSession,
        );
      });
    } finally {
      await dbSession.endSession();
    }
  }

  const ran: string[] = [];
  if (input.run) {
    if (await expirePlanIfDue(tenantId)) ran.push("plan expired");
    if (await enforceGraceFully(tenantId)) ran.push("extras archived");
    const reminders = await sendPlanRenewalReminders(new Date(), tenantId);
    if (reminders > 0) ran.push("reminder sent");
  }

  const updated = await Organization.findById(tenantId).setOptions({
    skipTenant: true,
  });
  return { organization: updated!, usage: await getPlanUsage(tenantId), ran };
}
