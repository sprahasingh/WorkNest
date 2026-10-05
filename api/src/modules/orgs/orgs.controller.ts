import type { Request, Response } from "express";
import { Organization } from "../../models/Organization.js";
import { requireTenantId } from "../../tenancy/context.js";
import { AppError } from "../../lib/errors.js";
import {
  isRazorpayConfigured,
  simulatedUpgradesAllowed,
} from "../../lib/razorpay.js";
import { PLAN_NAMES, planRank, type Plan } from "../../constants/plans.js";
import { getPlanUsage } from "../billing/planLifecycle.js";
import { changePlan, createOrg, updateOrg } from "./orgs.service.js";
import { reconcileSeats } from "../invites/invites.service.js";
import type {
  UpdateOrgInput,
  ChangePlanInput,
  CreateOrgInput,
} from "./orgs.schemas.js";

export async function createOrgController(
  req: Request,
  res: Response,
): Promise<void> {
  const input = req.validated!.body as CreateOrgInput;
  const organization = await createOrg(req.auth!.userId, input.name);
  res.status(201).json({ organization });
}

export async function getOrgController(
  req: Request,
  res: Response,
): Promise<void> {
  const tenantId = requireTenantId();
  await reconcileSeats(tenantId);
  const org = await Organization.findById(tenantId).setOptions({
    skipTenant: true,
  });

  if (!org) {
    throw new AppError(404, "NOT_FOUND", "Organization not found");
  }

  res
    .status(200)
    .json({ organization: org, usage: await getPlanUsage(tenantId) });
}

export async function updateOrgController(
  req: Request,
  res: Response,
): Promise<void> {
  const input = req.validated!.body as UpdateOrgInput;
  const org = await updateOrg(input);
  res.status(200).json({ organization: org });
}

// A paid plan has been paid for until its end date, so it can't be switched to
// a lower plan, or cancelled, before then. Free comes by itself when it ends,
// and a lower paid plan can be bought after that. Plans with no end date (set
// up before plans expired, or simulated) have nothing paid for, so they can
// still be changed.
async function assertPaidPlanCanBeLeft(target: Plan): Promise<void> {
  const org = await Organization.findById(requireTenantId())
    .select("plan planExpiresAt")
    .setOptions({ skipTenant: true })
    .lean();
  const current = (org?.plan ?? "free") as Plan;
  if (
    current === "free" ||
    planRank(target) >= planRank(current) ||
    !org?.planExpiresAt ||
    org.planExpiresAt <= new Date()
  ) {
    return;
  }
  throw new AppError(
    409,
    "PLAN_ACTIVE_UNTIL_END",
    target === "free"
      ? "Your current paid plan will remain active until it ends. You'll automatically switch to Free when it expires."
      : `You can switch to ${PLAN_NAMES[target]} after your current ${PLAN_NAMES[current]} plan ends.`,
    [
      {
        currentPlan: current,
        targetPlan: target,
        planExpiresAt: org.planExpiresAt.toISOString(),
      },
    ],
  );
}

export async function changePlanController(
  req: Request,
  res: Response,
): Promise<void> {
  const input = req.validated!.body as ChangePlanInput;
  await assertPaidPlanCanBeLeft(input.plan);
  // With payments switched on, moving up has to go through checkout. Moving
  // down is always free.
  const paymentsOn = isRazorpayConfigured();
  if (!paymentsOn && !simulatedUpgradesAllowed()) {
    const now = await Organization.findById(requireTenantId())
      .select("plan")
      .setOptions({ skipTenant: true })
      .lean();
    if (planRank(input.plan) > planRank((now?.plan ?? "free") as Plan)) {
      throw new AppError(
        503,
        "PAYMENTS_DISABLED",
        "Upgrading needs payments, which are not switched on for this app.",
      );
    }
  }
  if (paymentsOn) {
    const current = await Organization.findById(requireTenantId())
      .select("plan")
      .setOptions({ skipTenant: true })
      .lean();
    if (planRank(input.plan) > planRank((current?.plan ?? "free") as Plan)) {
      throw new AppError(
        402,
        "PAYMENT_REQUIRED",
        "Upgrading a plan needs a payment.",
      );
    }
  }
  // Seat numbers are re-counted first, so a stale counter can't decide a
  // downgrade.
  await reconcileSeats(requireTenantId());
  const org = await changePlan(input.plan);
  res.status(200).json({ organization: org });
}
