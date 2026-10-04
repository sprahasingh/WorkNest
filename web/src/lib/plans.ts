import type { Plan } from "@/api/auth";

export interface PlanLimits {
  seatLimit: number;
  projectLimit: number;
  // Per project; null means unlimited.
  activeTaskLimit: number | null;
}

// Mirrors api/src/constants/plans.ts; the server enforces these.
export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { seatLimit: 5, projectLimit: 3, activeTaskLimit: 10 },
  pro: { seatLimit: 30, projectLimit: 25, activeTaskLimit: 50 },
  premium: { seatLimit: 100, projectLimit: 50, activeTaskLimit: null },
};

export const PLAN_ORDER: Plan[] = ["free", "pro", "premium"];

export const PLAN_NAMES: Record<Plan, string> = {
  free: "Free",
  pro: "Pro",
  premium: "Premium",
};

export function formatTaskLimit(limit: number | null): string {
  return limit === null ? "Unlimited" : `Up to ${limit}`;
}

// What moving up to each plan costs, in paise (INR 499 and 999). It is a
// one-time upgrade, not a subscription. Mirrors api/src/constants/plans.ts.
export const PLAN_PRICE_PAISE: Record<Plan, number> = {
  free: 0,
  pro: 49900,
  premium: 99900,
};

export function formatRupees(paise: number): string {
  const rupees = paise / 100;
  return `\u20B9${rupees.toLocaleString("en-IN", {
    minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2,
  })}`;
}
