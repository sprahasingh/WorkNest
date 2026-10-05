import type { NextFunction, Request, Response } from "express";
import { PLAN_LIMITS, graceEndsAt, type Plan } from "../../constants/plans.js";
import { AppError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { Organization } from "../../models/Organization.js";
import { Task } from "../../models/Task.js";
import { binnedProjectIds } from "../../models/Project.js";
import { requireTenantId } from "../../tenancy/context.js";
import { enforceGraceIfDue } from "./gracePeriod.service.js";

// An organization whose paid plan has run out goes back to Free. This runs on
// the first request after the date passes, so it works even when the server
// was asleep at the moment of expiry. Nothing is blocked or deleted here: if
// the organization uses more than Free allows, it is locked (see below) until
// the extra work is removed or a plan is bought.
export async function expirePlanIfDue(
  tenantId: string,
  now = new Date(),
): Promise<boolean> {
  const free = PLAN_LIMITS.free;
  const org = await Organization.findOneAndUpdate(
    { _id: tenantId, plan: { $ne: "free" }, planExpiresAt: { $lte: now } },
    [
      {
        $set: {
          planExpiredFrom: "$plan",
          planExpiredAt: now,
          plan: "free",
          planExpiresAt: null,
          seatLimit: free.seatLimit,
          projectLimit: free.projectLimit,
        },
      },
    ],
    // An array is an update pipeline, which Mongoose only accepts when told so.
    { returnDocument: "before", updatePipeline: true },
  ).setOptions({ skipTenant: true });
  if (org) {
    logger.info({ tenantId, from: org.plan }, "Paid plan expired");
  }
  return org !== null;
}

// Moves every organization whose paid plan has ended back to Free, so a plan
// doesn't stay paid just because nobody has opened the app since.
export async function expireDuePlans(now = new Date()): Promise<number> {
  const due = await Organization.find({
    plan: { $ne: "free" },
    planExpiresAt: { $lte: now },
  })
    .select("_id")
    .setOptions({ skipTenant: true })
    .lean();
  let expired = 0;
  for (const org of due) {
    if (await expirePlanIfDue(String(org._id), now)) expired += 1;
  }
  return expired;
}

export interface PlanUsage {
  seatsUsed: number;
  seatLimit: number;
  projectCount: number;
  projectLimit: number;
  projectsOverTaskLimit: number;
  activeTaskLimit: number | null;
  // True when the organization uses more than its plan allows.
  overLimit: boolean;
  // After a paid plan ends there is a grace period, with nothing blocked, to
  // renew or cut usage. graceEndsAt is when the extras get archived.
  inGrace: boolean;
  graceEndsAt: string | null;
  // Over the plan with no grace left: changes are refused.
  paused: boolean;
}

export async function getPlanUsage(tenantId: string): Promise<PlanUsage> {
  const org = await Organization.findById(tenantId)
    .select(
      "plan seatsUsed seatLimit projectCount projectLimit planExpiredAt graceEnforcedAt",
    )
    .setOptions({ skipTenant: true })
    .lean();
  if (!org) throw new AppError(404, "NOT_FOUND", "Organization not found");

  const activeTaskLimit =
    PLAN_LIMITS[(org.plan ?? "free") as Plan].activeTaskLimit;
  let projectsOverTaskLimit = 0;
  if (activeTaskLimit !== null) {
    const binned = await binnedProjectIds();
    const rows = await Task.aggregate<{ _id: unknown }>([
      {
        $match: {
          status: { $ne: "done" },
          archivedAt: null,
          deletedAt: null,
          projectId: { $nin: binned },
        },
      },
      { $group: { _id: "$projectId", active: { $sum: 1 } } },
      { $match: { active: { $gt: activeTaskLimit } } },
    ]);
    projectsOverTaskLimit = rows.length;
  }

  const overLimit =
    org.seatsUsed > org.seatLimit ||
    org.projectCount > org.projectLimit ||
    projectsOverTaskLimit > 0;
  const graceEnd =
    org.plan === "free" && org.planExpiredAt && !org.graceEnforcedAt
      ? graceEndsAt(org.planExpiredAt)
      : null;
  const inGrace = graceEnd !== null && graceEnd > new Date();

  return {
    seatsUsed: org.seatsUsed,
    seatLimit: org.seatLimit,
    projectCount: org.projectCount,
    projectLimit: org.projectLimit,
    projectsOverTaskLimit,
    activeTaskLimit,
    overLimit,
    inGrace,
    graceEndsAt: inGrace ? graceEnd!.toISOString() : null,
    paused: overLimit && !inGrace,
  };
}

// While an organization is over its plan, people can still look around and
// take work away (delete, archive) or pay. Everything else that changes data
// is refused.
function allowedWhileOverLimit(req: Request): boolean {
  if (req.method === "DELETE") return true;
  const path = req.path.replace(/\/+$/, "");
  return (
    path.endsWith("/archive") ||
    path === "/plan" ||
    path === "/billing" ||
    path.startsWith("/billing/")
  );
}

export async function enforcePlanState(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const tenantId = requireTenantId();
  await expirePlanIfDue(tenantId);
  await enforceGraceIfDue(tenantId);
  if (
    req.method === "GET" ||
    req.method === "HEAD" ||
    req.method === "OPTIONS" ||
    allowedWhileOverLimit(req)
  ) {
    next();
    return;
  }
  const usage = await getPlanUsage(tenantId);
  if (usage.paused) {
    throw new AppError(
      403,
      "PLAN_OVER_LIMIT",
      "This account uses more than its plan allows. Delete or archive the extra projects or tasks, or upgrade your plan, to keep working.",
      [usage],
    );
  }
  next();
}
