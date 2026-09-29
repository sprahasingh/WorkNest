export const PLANS = ["free", "pro"] as const;
export type Plan = (typeof PLANS)[number];

export const FREE_PLAN_ACTIVE_TASK_LIMIT = 10;
