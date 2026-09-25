import { describe, it, expect } from "vitest";
import { can, PERMISSIONS, type Permission } from "../src/auth/rbac.js";
import { ROLES } from "../src/constants/roles.js";

const EXPECTED_MATRIX: Record<
  Permission,
  { admin: boolean; manager: boolean; member: boolean }
> = {
  "org:read": { admin: true, manager: true, member: true },
  "org:update": { admin: true, manager: false, member: false },
  "plan:change": { admin: true, manager: false, member: false },
  "member:read": { admin: true, manager: true, member: true },
  "member:manage": { admin: true, manager: false, member: false },
  "invite:manage": { admin: true, manager: false, member: false },
  "project:read": { admin: true, manager: true, member: true },
  "project:write": { admin: true, manager: true, member: false },
  "task:read": { admin: true, manager: true, member: true },
  "task:create": { admin: true, manager: true, member: true },
  "task:update:any": { admin: true, manager: true, member: false },
  "task:delete": { admin: true, manager: true, member: false },
  "task:assign": { admin: true, manager: true, member: false },
  "task:update:own": { admin: true, manager: true, member: true },
  "audit:read": { admin: true, manager: false, member: false },
  "dashboard:read": { admin: true, manager: true, member: false },
};

describe("RBAC matrix", () => {
  it("matches the documented permission table exactly, for every role and permission", () => {
    for (const permission of PERMISSIONS) {
      for (const role of ROLES) {
        const expected = EXPECTED_MATRIX[permission][role];
        const actual = can(role, permission);

        expect(
          actual,
          `expected can("${role}", "${permission}") to be ${expected}, got ${actual}`,
        ).toBe(expected);
      }
    }
  });

  it("has an entry in EXPECTED_MATRIX for every permission in PERMISSIONS", () => {
    for (const permission of PERMISSIONS) {
      expect(EXPECTED_MATRIX[permission]).toBeDefined();
    }
  });
});
