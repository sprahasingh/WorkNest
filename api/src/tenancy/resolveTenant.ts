import type { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { Membership } from "../models/Membership.js";
import { runWithTenant } from "./context.js";
import { AppError } from "../lib/errors.js";

export async function resolveTenant(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { orgId } = req.params;

  if (typeof orgId !== "string" || !mongoose.Types.ObjectId.isValid(orgId)) {
    throw new AppError(404, "NOT_FOUND", "Organization not found");
  }

  const userId = req.auth!.userId;

  const membership = await Membership.findOne({
    tenantId: new mongoose.Types.ObjectId(orgId),
    userId: new mongoose.Types.ObjectId(userId),
  }).setOptions({ skipTenant: true });

  if (!membership) {
    throw new AppError(404, "NOT_FOUND", "Organization not found");
  }

  runWithTenant({ tenantId: orgId, userId, role: membership.role }, () => {
    next();
  });
}
