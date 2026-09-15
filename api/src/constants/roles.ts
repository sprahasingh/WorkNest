export const ROLES = ["admin", "manager", "member"] as const;
export type Role = (typeof ROLES)[number];
