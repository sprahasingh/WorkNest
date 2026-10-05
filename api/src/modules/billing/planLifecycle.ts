import type { NextFunction, Request, Response } from "express";
import { PLAN_LIMITS, graceEndsAt, type Plan } from "../../constants/plans.js";
import { AppError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { Organization } from "../../models/Organization.js";
import { requireTenantId } from "../../tenancy/context.js";
import { countProjectsOverTaskLimit } from "./taskUsage.js";
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
          // A new expiry starts a new grace period.
          graceEnforcedAt: null,
          graceEnforcingAt: null,
          graceArchived: null,
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
  // The grace period is over and the extra projects and tasks have been
  // archived (or there was nothing to archive).
  graceEnforced: boolean;
  // Over on projects or tasks, as opposed to seats, which can't be archived.
  workOverLimit: boolean;
  // Over the plan during the grace period, or while the archiving that ends
  // it is still due: nothing new can be added, but everything that brings
  // usage down or keeps work going still works.
  restricted: boolean;
  // Over the plan with no grace left (seats): changes are refused.
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
  const projectsOverTaskLimit =
    await countProjectsOverTaskLimit(activeTaskLimit);

  const workOverLimit =
    org.projectCount > org.projectLimit || projectsOverTaskLimit > 0;
  const overLimit = workOverLimit || org.seatsUsed > org.seatLimit;
  const graceEnd =
    org.plan === "free" && org.planExpiredAt
      ? graceEndsAt(org.planExpiredAt)
      : null;
  const graceOver = graceEnd !== null && graceEnd <= new Date();
  const inGrace = graceEnd !== null && !graceOver;
  const graceEnforced = graceOver && Boolean(org.graceEnforcedAt);
  const archivalDue = graceOver && !graceEnforced;

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
    graceEnforced,
    workOverLimit,
    restricted: overLimit && (inGrace || archivalDue),
    paused: overLimit && !inGrace && !archivalDue,
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

// Things that add to what a workspace uses: new projects and tasks, invites,
// and bringing archived or binned work back.
function growsUsage(req: Request): boolean {
  const path = req.path.replace(/\/+$/, "");
  if (req.method === "POST") {
    return (
      path === "/projects" ||
      /^\/projects\/[^/]+\/tasks$/.test(path) ||
      path === "/invites" ||
      path.endsWith("/restore") ||
      path.endsWith("/unarchive")
    );
  }
  return req.method === "PATCH" && path.endsWith("/unarchive");
}

// The grace period, then the archiving that ends it. Safe to call on every
// request: it does nothing unless an organization is due.
export async function enforceGraceFully(tenantId: string): Promise<boolean> {
  let ran = await enforceGraceIfDue(tenantId);
  // Archiving already happened but the workspace is over on projects or tasks
  // again (an earlier run failed halfway, or limits changed): finish the job.
  const usage = await getPlanUsage(tenantId);
  if (usage.graceEnforced && usage.workOverLimit) {
    ran = (await enforceGraceIfDue(tenantId, { again: true })) || ran;
  }
  return ran;
}

export async function enforcePlanState(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const tenantId = requireTenantId();
  await expirePlanIfDue(tenantId);
  if (
    req.method === "GET" ||
    req.method === "HEAD" ||
    req.method === "OPTIONS" ||
    allowedWhileOverLimit(req)
  ) {
    // Reading is never blocked, but it still moves a due archiving along.
    await enforceGraceIfDue(tenantId);
    next();
    return;
  }
  await enforceGraceFully(tenantId);
  const usage = await getPlanUsage(tenantId);
  if (usage.paused) {
    throw new AppError(
      403,
      "PLAN_OVER_LIMIT",
      "This account uses more than its plan allows. Delete or archive the extra projects or tasks, or upgrade your plan, to keep working.",
      [usage],
    );
  }
  if (usage.restricted && growsUsage(req)) {
    throw new AppError(
      403,
      "PLAN_GRACE_RESTRICTED",
      usage.inGrace
        ? "Your workspace is over the Free plan limits, so nothing new can be added until you renew or bring usage down by deleting or archiving the extras. Extra projects and tasks are archived automatically when the grace period ends."
        : "Your workspace is over the Free plan limits, so nothing new can be added until you renew or bring usage down.",
      [usage],
    );
  }
  next();
}
