import type { Request, Response, NextFunction } from "express";
import { can, type Permission } from "./rbac.js";
import { getTenantContext } from "../tenancy/context.js";
import { AppError } from "../lib/errors.js";
import type { Role } from "../constants/roles.js";

export function requirePermission(permission: Permission) {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    const context = getTenantContext();

    if (!context || !context.role) {
      throw new AppError(
        500,
        "TENANT_CONTEXT_MISSING",
        "No tenant context available for this operation",
      );
    }

    if (!can(context.role as Role, permission)) {
      throw new AppError(
        403,
        "FORBIDDEN",
        "You do not have permission to perform this action",
      );
    }

    next();
  };
}
