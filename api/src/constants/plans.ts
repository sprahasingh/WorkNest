export const PLANS = ["free", "pro", "premium"] as const;
export type Plan = (typeof PLANS)[number];

export interface PlanLimits {
  seatLimit: number;
  projectLimit: number;
  // Per project; null means unlimited.
  activeTaskLimit: number | null;
}

// The single source of truth for what each plan allows. Keep in sync with
// web/src/lib/plans.ts.
export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { seatLimit: 5, projectLimit: 3, activeTaskLimit: 10 },
  pro: { seatLimit: 30, projectLimit: 25, activeTaskLimit: 50 },
  premium: { seatLimit: 100, projectLimit: 50, activeTaskLimit: null },
};

export const PLAN_NAMES: Record<Plan, string> = {
  free: "Free",
  pro: "Pro",
  premium: "Premium",
};

export const BILLING_CYCLES = ["monthly", "yearly"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

// What each plan costs for a month or a year, in paise (INR 449 and 1,149 a
// month, 4,499 and 11,499 a year). Paying buys one period; nothing renews by
// itself. Keep in sync with web/src/lib/plans.ts.
export const PLAN_PRICE_PAISE: Record<Plan, Record<BillingCycle, number>> = {
  free: { monthly: 0, yearly: 0 },
  pro: { monthly: 44900, yearly: 449900 },
  premium: { monthly: 114900, yearly: 1149900 },
};

export function planRank(plan: Plan): number {
  return PLANS.indexOf(plan);
}

// The end of a paid period that starts at `from`.
export function addBillingPeriod(from: Date, cycle: BillingCycle): Date {
  const end = new Date(from);
  end.setMonth(end.getMonth() + (cycle === "yearly" ? 12 : 1));
  return end;
}

export interface PlanQuote {
  // In paise.
  amount: number;
  // When the plan ends once this is paid.
  expiresAt: Date;
}

interface BillingState {
  plan: Plan;
  planExpiresAt?: Date | null;
  billingCycle?: BillingCycle | null;
}

// What buying `target` for `cycle` costs this organization right now, or null
// when it can't be bought (a lower plan, or Free).
//   - Moving up while a paid plan of the same cycle is running costs the
//     difference and keeps the current end date.
//   - Renewing the same plan costs the full price and adds a period on top of
//     the current end date (or from today if it has ended or is a different
//     cycle).
//   - Anything else costs the full price for a period starting today.
export function quotePlan(
  org: BillingState,
  target: Plan,
  cycle: BillingCycle,
  now = new Date(),
): PlanQuote | null {
  if (target === "free" || planRank(target) < planRank(org.plan)) return null;
  const full = PLAN_PRICE_PAISE[target][cycle];
  const running =
    org.plan !== "free" &&
    org.planExpiresAt != null &&
    org.planExpiresAt > now &&
    org.billingCycle === cycle;

  if (target === org.plan) {
    return {
      amount: full,
      expiresAt: addBillingPeriod(running ? org.planExpiresAt! : now, cycle),
    };
  }
  if (running) {
    return {
      amount: Math.max(0, full - PLAN_PRICE_PAISE[org.plan][cycle]),
      expiresAt: org.planExpiresAt!,
    };
  }
  return { amount: full, expiresAt: addBillingPeriod(now, cycle) };
}

// After a paid plan ends, the workspace has this long to renew or cut its
// usage before the extra projects and tasks are archived.
export const GRACE_PERIOD_DAYS = 10;

export function graceEndsAt(planExpiredAt: Date): Date {
  return new Date(planExpiredAt.getTime() + GRACE_PERIOD_DAYS * 86_400_000);
}
