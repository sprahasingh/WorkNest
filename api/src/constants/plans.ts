export const PLANS = ["free", "pro"] as const;
export type Plan = (typeof PLANS)[number];
