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
