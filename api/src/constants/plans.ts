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

// What each plan costs to move up to, in paise (INR 599.00 and 1,199.00). Paying
// is a one-time upgrade, not a subscription. Moving from Pro to Premium costs
// the difference. Keep in sync with web/src/lib/plans.ts.
export const PLAN_PRICE_PAISE: Record<Plan, number> = {
  free: 0,
  pro: 59900,
  premium: 119900,
};

export function planRank(plan: Plan): number {
  return PLANS.indexOf(plan);
}

export function upgradeAmountPaise(from: Plan, to: Plan): number {
  return Math.max(0, PLAN_PRICE_PAISE[to] - PLAN_PRICE_PAISE[from]);
}
