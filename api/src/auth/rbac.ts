import type { Role } from "../constants/roles.js";

export const PERMISSIONS = [
  "org:update",
  "plan:change",
  "member:read",
  "member:manage",
  "invite:manage",
  "project:read",
  "project:write",
  "task:read",
  "task:create",
  "task:update:any",
  "task:delete",
  "task:assign",
  "task:update:own",
  "audit:read",
  "dashboard:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set<Permission>([
    "org:update",
    "plan:change",
    "member:read",
    "member:manage",
    "invite:manage",
    "project:read",
    "project:write",
    "task:read",
    "task:create",
    "task:update:any",
    "task:delete",
    "task:assign",
    "task:update:own",
    "audit:read",
    "dashboard:read",
  ]),
  manager: new Set<Permission>([
    "member:read",
    "project:read",
    "project:write",
    "task:read",
    "task:create",
    "task:update:any",
    "task:delete",
    "task:assign",
    "task:update:own",
    "dashboard:read",
  ]),
  member: new Set<Permission>([
    "member:read",
    "project:read",
    "task:read",
    "task:create",
    "task:update:own",
  ]),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}
