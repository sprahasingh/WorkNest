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

export type BillingCycle = "monthly" | "yearly";

// What each plan costs for a month or a year, in paise (INR 449 and 1,149 a
// month, 4,499 and 11,499 a year). Paying buys one period; nothing renews by
// itself. Mirrors api/src/constants/plans.ts.
export const PLAN_PRICE_PAISE: Record<Plan, Record<BillingCycle, number>> = {
  free: { monthly: 0, yearly: 0 },
  pro: { monthly: 44900, yearly: 449900 },
  premium: { monthly: 114900, yearly: 1149900 },
};

export function formatRupees(paise: number): string {
  const rupees = paise / 100;
  return `\u20B9${rupees.toLocaleString("en-IN", {
    minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2,
  })}`;
}
