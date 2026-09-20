import type { Request, Response } from "express";
import { Organization } from "../../models/Organization.js";
import { requireTenantId } from "../../tenancy/context.js";
import { AppError } from "../../lib/errors.js";
import type { UpdateOrgInput } from "./orgs.schemas.js";

export async function getOrgController(
  req: Request,
  res: Response,
): Promise<void> {
  const tenantId = requireTenantId();
  const org = await Organization.findById(tenantId).setOptions({
    skipTenant: true,
  });

  if (!org) {
    throw new AppError(404, "NOT_FOUND", "Organization not found");
  }

  res.status(200).json({ organization: org });
}

export async function updateOrgController(
  req: Request,
  res: Response,
): Promise<void> {
  const input = req.validated!.body as UpdateOrgInput;
  const tenantId = requireTenantId();

  const org = await Organization.findByIdAndUpdate(
    tenantId,
    { name: input.name },
    { new: true, runValidators: true },
  ).setOptions({ skipTenant: true });

  if (!org) {
    throw new AppError(404, "NOT_FOUND", "Organization not found");
  }

  res.status(200).json({ organization: org });
}
